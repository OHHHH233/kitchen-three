# O.家庭装修 · V.1.04

2026-10-30 发布快照，适用于 GitHub Pages，无需构建或安装依赖。

## 内容

- 01 一楼「硬装」：空间视图、铺贴排版、原砖切割排版及尺寸。
- 02 厨房「橱柜、吊柜」：分区显示、独立尺寸与柜门显隐、两种透视视角。
- 03 二楼「硬装」：800×800 / 1500×750 瓷砖组别切换、排版及原砖切割图；软装默认隐藏。
- 已包含最新模型、修复后的真实砖缝、浅色斜纹及最新标注 JSON。
- 瓷砖透明度为 0%，已移除瓷砖透明度滑杆；控制区布局统一。
- 操作区、模型和排版图不再触发文字拖选；标注输入框可正常编辑、选择和复制。
- 保留旧版入口 v1.html。Three.js 和全部模型、贴图随包提供。

## 发布到 GitHub Pages

1. 将本目录内的文件放入 kitchen-three 仓库根目录，保留 public、.github 等目录结构。
2. 仓库 Settings → Pages → Source 选择 GitHub Actions。
3. 提交到 main；随附的 .github/workflows/pages.yml 会发布网站。
4. 访问 https://ohhhh233.github.io/kitchen-three/?v=1.04 。

本包尚未提交或发布。可从 Actions 手动运行 Deploy GitHub Pages。

## 本地预览与标注

在本目录执行 `python -m http.server 8765`，打开 http://127.0.0.1:8765/ 。
请通过 HTTP 访问，直接双击 HTML 无法加载模型。

模型视图右上角可添加文字并设置颜色、字号。导出 JSON 后替换 public/annotations.json，
再次发布，其他访问者即可看到；不需要 API。现有文件已关联当前模型版本。

## 版本核对

release.json 记录模型和标注文件 SHA-256；SHA256SUMS.json 记录包内文件校验值。
不包含 Blender 源工程、浏览器数据、临时文件和本机草稿。
