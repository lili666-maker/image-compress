'use strict';

const $ = id => document.getElementById(id);
const MAX_IMAGE_PIXELS = 100 * 1000 * 1000;
const HISTORY_KEY = 'image_compress_history_v2';

const input = $('file-input');
const zone = $('drop-zone');
const qualityInput = $('quality');
const qualityValue = $('quality-value');
const status = $('status');
const beforeImage = $('preview-before');
const afterImage = $('preview-after');
const compressButton = $('btn-compress');
const downloadButton = $('btn-download');

let currentFile = null;
let previewUrl = null;
let resultUrl = null;
let resultDownloadName = null;
let avifDecodeOk = false;

const WEBP_ENCODE_OK = detectEncoder('image/webp');
const AVIF_ENCODE_OK = detectEncoder('image/avif');

/* 用 1x1 画布探测浏览器能否把图片编码成对应格式 */
function detectEncoder(mime) {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    return canvas.toDataURL(mime).indexOf('data:' + mime) === 0;
  } catch (_error) {
    return false;
  }
}

/* 1x1 最小 AVIF 图片，用于探测浏览器能否解码 AVIF */
const AVIF_PROBE_URL = 'data:image/avif;base64,AAAAIGZ0eXBhdmlmAAAAAGF2aWZtaWYxbWlhZk1BMUIAAADybWV0YQAAAAAAAAAoaGRscgAAAAAAAAAAcGljdAAAAAAAAAAAAAAAAGxpYmF2aWYAAAAADnBpdG0AAAAAAAEAAAAeaWxvYwAAAABEAAABAAEAAAABAAABGgAAAB0AAAAoaWluZgAAAAAAAQAAABppbmZlAgAAAAABAABhdjAxQ29sb3IAAAAAamlwcnAAAABLaXBjbwAAABRpc3BlAAAAAAAAAAEAAAABAAAAEHBpeGkAAAAAAwgICAAAAAxhdjFDgQ0MAAAAABNjb2xybmNseAACAAIABoAAAAAXaXBtYQAAAAAAAAABAAEEAQKDBAAAACVtZGF0EgAKCBgADsgQEAwgMg8f8D///8WfhwB8+ErK42A=';

async function detectAvifDecode() {
  try {
    const image = new Image();
    image.src = AVIF_PROBE_URL;
    await image.decode();
    return true;
  } catch (_error) {
    return false;
  }
}

function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1024 / 1024).toFixed(2) + ' MB';
}

function formatNow() {
  const date = new Date();
  const pad = value => String(value).padStart(2, '0');
  return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate())
    + ' ' + pad(date.getHours()) + ':' + pad(date.getMinutes());
}

function setStatus(message, state = '') {
  status.textContent = message;
  status.className = 'status' + (state ? ' is-' + state : '');
}

function supportedExtensions() {
  return avifDecodeOk ? ['jpe?g', 'png', 'webp', 'avif'] : ['jpe?g', 'png', 'webp'];
}

function isSupportedFile(file) {
  return new RegExp('\\.(' + supportedExtensions().join('|') + ')$', 'i').test(file.name);
}

/*
 * 解码图片：
 * 优先 createImageBitmap（按 EXIF 方向转正、性能最好）；
 * 不支持时降级为 Image 元素解码（现代浏览器同样会应用 EXIF 方向）。
 * 两种路径得到的像素都不携带原始元数据，重编码后 EXIF/GPS 自然被剥离。
 */
async function decodeImage(file) {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
      return { source: bitmap, release: () => bitmap.close() };
    } catch (_error) {
      /* 部分浏览器不支持 imageOrientation 选项，走通用降级路径 */
    }
  }

  const url = URL.createObjectURL(file);
  const image = new Image();
  image.src = url;
  try {
    await new Promise((resolve, reject) => {
      if (typeof image.decode === 'function') {
        image.decode().then(resolve, () => {
          image.onload = resolve;
          image.onerror = () => reject(new Error('当前浏览器无法解码这张图片。'));
        });
      } else {
        image.onload = resolve;
        image.onerror = () => reject(new Error('当前浏览器无法解码这张图片。'));
      }
    });
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
  return { source: image, release: () => URL.revokeObjectURL(url) };
}

/* 输出格式跟随输入格式；浏览器不支持编码该格式时自动降级并返回提示 */
function chooseOutput(file) {
  const name = file.name.toLowerCase();
  if (/\.png$/.test(name)) return { mime: 'image/png', note: '' };
  if (/\.webp$/.test(name)) {
    return WEBP_ENCODE_OK
      ? { mime: 'image/webp', note: '' }
      : { mime: 'image/jpeg', note: '当前浏览器不支持 WEBP 输出，已改为 JPG' };
  }
  if (/\.avif$/.test(name)) {
    if (AVIF_ENCODE_OK) return { mime: 'image/avif', note: '' };
    return WEBP_ENCODE_OK
      ? { mime: 'image/webp', note: '当前浏览器不支持 AVIF 输出，已改为 WEBP' }
      : { mime: 'image/jpeg', note: '当前浏览器不支持 AVIF 输出，已改为 JPG' };
  }
  return { mime: 'image/jpeg', note: '' };
}

function buildDownloadName(originalName, mime) {
  const extMap = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/avif': 'avif' };
  const base = originalName.replace(/\.[^.]+$/, '');
  return base + '_compressed.' + (extMap[mime] || 'jpg');
}

async function compressLocally(file, qualityPercent) {
  const decoded = await decodeImage(file);
  try {
    const width = decoded.source.naturalWidth || decoded.source.width;
    const height = decoded.source.naturalHeight || decoded.source.height;
    if (!width || !height) throw new Error('无法读取图片尺寸，文件可能已损坏。');
    if (width * height > MAX_IMAGE_PIXELS) {
      throw new Error('图片超过 1 亿像素上限，请先缩小尺寸后再压缩。');
    }

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    const target = chooseOutput(file);

    /* JPG 不支持透明通道，先铺白底，避免透明区域变黑 */
    if (target.mime === 'image/jpeg') {
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, width, height);
    }
    context.drawImage(decoded.source, 0, 0, width, height);

    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob(
        value => (value ? resolve(value) : reject(new Error('图片编码失败，请换一张图片或降低质量后重试。'))),
        target.mime,
        target.mime === 'image/png' ? undefined : qualityPercent / 100
      );
    });
    return { blob, note: target.note };
  } finally {
    decoded.release();
  }
}

function clearResult() {
  resultUrl = null;
  resultDownloadName = null;
  afterImage.removeAttribute('src');
  afterImage.hidden = true;
  $('size-after').textContent = '等待处理';
  $('ratio').textContent = '';
  downloadButton.hidden = true;
}

function setFile(file) {
  if (!isSupportedFile(file)) {
    setStatus(avifDecodeOk ? '请选择 JPG、JPEG、PNG、WEBP 或 AVIF 图片。' : '请选择 JPG、JPEG、PNG 或 WEBP 图片。', 'error');
    return;
  }

  currentFile = file;
  clearResult();
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = URL.createObjectURL(file);
  beforeImage.src = previewUrl;
  beforeImage.hidden = false;
  beforeImage.onerror = () => {
    beforeImage.hidden = true;
    $('size-before').textContent = '当前浏览器无法预览此格式';
  };
  $('size-before').textContent = formatSize(file.size);
  compressButton.disabled = false;
  setStatus('已选择 ' + file.name + '，可以开始压缩。', 'ready');
}

function getHistory() {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY)) || [];
  } catch (_error) {
    return [];
  }
}

function saveHistory(record) {
  const records = getHistory();
  records.unshift(record);
  records.splice(50);
  localStorage.setItem(HISTORY_KEY, JSON.stringify(records));
}

function deleteHistoryAt(index) {
  const records = getHistory();
  if (index < 0 || index >= records.length) return;
  records.splice(index, 1);
  localStorage.setItem(HISTORY_KEY, JSON.stringify(records));
  renderHistory();
  setStatus('已删除 1 条本机历史。', 'ready');
}

function renderHistory() {
  const body = $('history-table').querySelector('tbody');
  const records = getHistory();
  body.replaceChildren();
  if (!records.length) {
    const row = document.createElement('tr');
    const cell = document.createElement('td');
    cell.colSpan = 6;
    cell.className = 'empty';
    cell.textContent = '暂无本机压缩记录';
    row.appendChild(cell);
    body.appendChild(row);
    return;
  }

  records.forEach((record, index) => {
    const row = document.createElement('tr');
    [
      record.fileName,
      formatSize(record.originalSize),
      formatSize(record.compressedSize),
      record.ratio >= 0.05 ? '节省 ' + record.ratio.toFixed(1) + '%' : '未缩小',
      record.createdAt,
    ].forEach(value => {
      const cell = document.createElement('td');
      cell.textContent = value;
      row.appendChild(cell);
    });

    const actionCell = document.createElement('td');
    const deleteButton = document.createElement('button');
    deleteButton.type = 'button';
    deleteButton.className = 'text-button history-delete';
    deleteButton.textContent = '清除';
    deleteButton.setAttribute('aria-label', '清除 ' + record.fileName + ' 的历史');
    deleteButton.addEventListener('click', () => deleteHistoryAt(index));
    actionCell.appendChild(deleteButton);
    row.appendChild(actionCell);
    body.appendChild(row);
  });
}

qualityInput.addEventListener('input', () => {
  qualityValue.textContent = qualityInput.value;
  updateQualityButtons();
});

function updateQualityButtons() {
  document.querySelectorAll('[data-quality]').forEach(button => {
    button.classList.toggle('is-selected', Number(button.dataset.quality) === Number(qualityInput.value));
  });
}

document.querySelectorAll('[data-quality]').forEach(button => {
  button.addEventListener('click', () => {
    qualityInput.value = button.dataset.quality;
    qualityInput.dispatchEvent(new Event('input'));
  });
});

zone.addEventListener('click', () => input.click());
zone.addEventListener('keydown', event => {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    input.click();
  }
});
zone.addEventListener('dragover', event => {
  event.preventDefault();
  zone.classList.add('is-dragover');
});
zone.addEventListener('dragleave', () => zone.classList.remove('is-dragover'));
zone.addEventListener('drop', event => {
  event.preventDefault();
  zone.classList.remove('is-dragover');
  if (event.dataTransfer.files.length) setFile(event.dataTransfer.files[0]);
});
input.addEventListener('change', () => {
  if (input.files.length) setFile(input.files[0]);
});

compressButton.addEventListener('click', async () => {
  if (!currentFile) return;

  compressButton.disabled = true;
  clearResult();
  setStatus('正在本地压缩，大图可能需要几秒，请不要关闭页面。', 'working');

  try {
    const encoded = await compressLocally(currentFile, Number(qualityInput.value));
    /*
     * 输出永不大于原图：重编码结果反而更大（原图已高度压缩、图片太小
     * 或输出格式降级）时，直接保留原文件供下载，并如实提示。
     */
    const keptOriginal = encoded.blob.size >= currentFile.size;
    const resultBlob = keptOriginal ? currentFile : encoded.blob;
    const resultNote = keptOriginal
      ? '原图已最优，已保留原图（源文件元数据未清除）'
      : encoded.note;

    if (resultUrl) URL.revokeObjectURL(resultUrl);
    resultUrl = URL.createObjectURL(resultBlob);
    resultDownloadName = keptOriginal ? currentFile.name : buildDownloadName(currentFile.name, resultBlob.type);

    $('size-after').textContent = formatSize(resultBlob.size);
    const ratio = ((currentFile.size - resultBlob.size) / currentFile.size) * 100;
    const ratioText = ratio >= 0.05 ? '节省 ' + ratio.toFixed(1) + '%' : '已移除元数据，文件未缩小';
    $('ratio').textContent = keptOriginal
      ? resultNote
      : ratioText + (resultNote ? '（' + resultNote + '）' : '');

    afterImage.src = resultUrl;
    afterImage.hidden = false;
    afterImage.onerror = () => {
      afterImage.hidden = true;
      $('ratio').textContent = $('ratio').textContent + '。当前浏览器不支持预览该格式，但仍可下载。';
    };
    downloadButton.hidden = false;
    setStatus('处理完成。图片全程未离开你的设备，点击下载即可保存。', 'success');
    saveHistory({
      fileName: currentFile.name,
      originalSize: currentFile.size,
      compressedSize: resultBlob.size,
      ratio: ratio,
      createdAt: formatNow(),
    });
    renderHistory();
  } catch (error) {
    const message = error && error.message ? error.message : '压缩失败，请重试。';
    setStatus(/memory|allocation/i.test(message)
      ? '图片过大，当前设备内存不足，请换一张小一点的图片。'
      : message, 'error');
  } finally {
    compressButton.disabled = false;
  }
});

downloadButton.addEventListener('click', () => {
  if (!resultUrl) return;
  const link = document.createElement('a');
  link.href = resultUrl;
  link.download = resultDownloadName || 'compressed_image';
  document.body.appendChild(link);
  link.click();
  link.remove();
});

$('btn-clear-history').addEventListener('click', () => {
  localStorage.removeItem(HISTORY_KEY);
  renderHistory();
  setStatus('已清除当前浏览器中的本机历史。', 'ready');
});

/* AVIF 能力探测是异步的：支持时补全 accept 列表并更新文案 */
async function init() {
  renderHistory();
  avifDecodeOk = await detectAvifDecode();
  if (!avifDecodeOk) return;
  const current = input.getAttribute('accept') || '';
  if (current.indexOf('.avif') === -1) input.setAttribute('accept', current + ',.avif');
  const note = $('format-note');
  if (note) {
    note.textContent = '支持 JPG、JPEG、PNG、WEBP、AVIF；单张最大 1 亿像素。压缩在浏览器本地完成，结果不保留原图元数据（含拍摄位置等隐私信息）。';
  }
}

init();
