# 在线图片压缩工具（纯前端版）

一个无需服务器、无需注册的免费图片压缩工具：访客选图后，压缩在**自己的浏览器**里完成，图片不上传到任何服务器，关闭页面即自动消失。

## 功能特性

- 本地压缩：零上传、隐私安全，自动清除 EXIF / GPS 等全部元数据
- 支持 JPG、JPEG、PNG、WEBP；浏览器支持 AVIF 时自动启用
- 质量滑块 + 高画质 / 均衡 / 高压缩 三档预设
- 压缩前后大小对比与节省比例
- 本机历史记录（保存在浏览器 localStorage，最多 50 条，可一键清除）
- 单张最大 1 亿像素（100MP），超出会明确提示

不支持 GIF 动图、HEIC、TIFF、RAW、PSD、SVG 等格式。PNG 为无损格式，质量滑块对它效果有限。

## 目录结构

```text
index.html          # 页面入口（根目录，静态托管直接可用）
static/css/style.css
static/js/script.js # Canvas 本地压缩引擎
.nojekyll           # GitHub Pages 跳过 Jekyll 处理
```

## 本地试用

没有网络请求，直接双击 `index.html` 就能完整使用。也可以起一个本地服务：

```powershell
python -m http.server 8000
# 打开 http://127.0.0.1:8000
```

## 部署到 GitHub Pages

1. 在 GitHub 新建一个 Public 仓库（例如 `image-compress`）。
2. 本地推送代码：

```powershell
git remote add origin https://github.com/你的用户名/image-compress.git
git branch -M main
git push -u origin main
```

3. 打开仓库页面 → `Settings` → `Pages` → Source 选择 `Deploy from a branch` → 分支选 `main`、目录选 `/ (root)` → `Save`。
4. 等 1-2 分钟，访问 `https://你的用户名.github.io/image-compress/` 即可。

## 部署到腾讯 EdgeOne Makers（原 EdgeOne Pages，大陆访问更快）

1. 打开 [EdgeOne Makers 官方站](https://pages.edgeone.ai/zh/)（或在腾讯云控制台搜索 EdgeOne），用微信扫码或 GitHub 账号登录并开通免费版。
2. 创建项目 → 导入 Git 仓库 → 授权 GitHub → 选中本仓库，分支保持 `main`。
3. 构建配置：框架预设选「无/静态」，构建命令与安装命令留空，输出目录保持根目录；新版界面若没有这些字段，保持默认即可。
4. 部署完成后获得 `xxx.edgeone.app` 免费域名，对大陆访客的连通性最好。

两个平台同时部署、共用同一份代码：推一次 `git push`，两边都会自动更新。

## 常见问题

- **AVIF 选项没出现？** 当前浏览器不支持 AVIF，工具自动隐藏了该格式；换新版 Chrome / Edge 即可。
- **大图片卡住？** 超过 1 亿像素的图会被拦截；手机处理几千万像素的大图可能需要几秒。
- **PNG 压了没变小？** PNG 是无损格式，Canvas 对 PNG 不使用质量参数；想要明显变小建议改用 JPG / WEBP。
- **为什么有时提示"已保留原图"？** 原图本身已高度压缩（或图太小）时，重编码反而可能变大。此时工具会跳过重编码、直接保留原文件，保证下载结果永远不大于原图；注意这种情况不会清除原文件的元数据。

## 技术说明

- 压缩：Canvas 2D + `canvas.toBlob`，滑块数值直接映射编码质量参数
- 隐私：按 EXIF 方向解码位图后重新编码，天然剥离全部元数据（含拍摄位置）
- 兼容：Chrome / Edge / Firefox / Safari 现代版、微信内置浏览器均可；老浏览器自动走 Image 元素降级解码路径

## 历史版本

最初的 Flask + Pillow 服务器版已移除。改造前的完整代码保存在 git 历史的首次提交中，需要找回时：

```powershell
git log --oneline                # 找到「存档：Flask 服务器版」的提交号
git checkout <提交号> -- app.py requirements.txt templates tests deploy
```
