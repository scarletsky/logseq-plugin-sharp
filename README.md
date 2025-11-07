# Logseq 图片压缩插件

## 插件简介

本插件用于拦截 Logseq 中粘贴或拖拽插入的图片，将原图上传到自定义压缩服务，返回压缩结果后弹出对比对话框，用户可选择保留原图或压缩图。插件会：

- 自动检测 block 中新增的图片 Markdown。
- 调用配置的压缩服务器（`multipart/form-data` 字段名为 `image`）。
- 展示原图与压缩图的大小、预览对比，并在用户确认后更新 block 内容。

## 运行截图

![插件设置面板，用户配置压缩服务器地址](docs/compress_settings.png)

![检测到图片后弹出的压缩确认对话框](docs/compress_confirm.png)

![压缩完成后展示原图与压缩图的挑选界面](docs/compress_pick.png)

![最终结果提示，显示插入的图片信息](docs/compress_result.png)

## 当前限制与资产目录现状

在 Logseq 现有插件 API 下，我们无法在宿主应用把原图写入 `assets/` 之前拦截该流程，也无法直接覆盖默认的粘贴/拖拽逻辑。实践过程中尝试过：

1. **宿主文件系统桥接**：在桌面端利用 `window.parent.require('fs')` 覆写 `assets/` 中的原图，但在 Web 端或禁用 Node Integration 时不可用，且存在兼容性风险。
2. **沙盒存储回退**：使用 `logseq.Assets.makeSandboxStorage()` 写入插件私有目录 `assets/storages/<plugin-id>/`，保证所有环境都可运行。

由于 Logseq 目前不会在写入前提供可拦截的事件，插件默认流程是：原图先写入 `assets/`，压缩文件再写到 `assets/storages/<plugin-id>/`。这意味着最终会同时保留两份图片，`assets/` 目录的体积不会减少，反而可能因为保留原图而变大。请在使用插件时注意这一点，并在压缩完成后按需手动清理原始文件或借助文件系统桥接自行替换。若未来 Logseq 提供更可控的插入钩子或文件写入 API，我们会尝试更新插件以真正覆盖原图。*** End Patch```ಮ
