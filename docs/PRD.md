# Logseq 图片压缩插件 PRD

## 概述

本项目是一个 Logseq 插件，用于压缩用户插入的图片。当用户插入图片时（如通过粘贴），插件会询问用户是否要使用本插件进行压缩。确认后，将要插入的图片发送到指定服务器进行压缩。收到压缩结果后，弹出对话框展示原始图片和压缩图片的对比（包括大小和视觉差异），允许用户选择插入哪一张图片。然后插入选定的图片，丢弃另一张。

插件必须遵循 Logseq 的设计风格。指定服务器需要在「设置」页面指定，设置方式必须遵循 Logseq 插件运行指南。

## 功能

### 核心功能
- **图片插入检测**：检测用户何时在 Logseq 中插入图片。
- **压缩提示**：在插入前提示用户是否压缩图片。
- **服务器压缩**：将原始图片以 multipart/form-data 格式发送到配置的服务器进行压缩处理，字段名为 'image'。在等待返回的过程中，显示与 Logseq 统一设计风格的 loading 提示。
- **对比对话框**：显示对话框，展示：
  - 原始图片大小 vs. 压缩图片大小
  - 图片的视觉对比
- **图片选择和插入**：允许用户选择插入哪张图片，然后插入选定的图片并丢弃另一张。

### 设置
- **服务器配置**：允许用户在 Logseq 设置页面配置图片压缩的服务器 URL。
- 设置必须按照 Logseq 的插件设置约定实现。

## 设计要求
- **UI/UX**：遵循 Logseq 的设计语言，包括样式、布局和用户交互模式。
- **一致性**：确保插件无缝集成到 Logseq 的界面和行为中。
- **主题适配**：插件 UI 必须支持 Logseq 的亮色和暗色主题，使用 CSS 变量 (--ls-primary-background-color, --ls-primary-text-color 等) 确保背景、文字和按钮颜色正确显示，提供良好的可读性。

## 技术要求
- **平台**：兼容 Logseq 的插件系统。
- **APIs**：利用 Logseq 的插件 APIs 处理图片、设置和 UI 组件。
- **开发脚手架**：基于 https://github.com/pengx17/logseq-plugin-template-react。
- **安全性**：安全处理图片数据，确保无未经授权的访问或数据泄露。
- **性能**：确保高效的图片处理，对 Logseq 的性能影响最小。
- **错误处理**：为压缩失败或服务器问题提供适当的错误消息。
- **主题适配实现**：由于插件运行在 iframe 中，无法直接访问宿主页面的 CSS 变量，通过 `window.parent.document` 获取 Logseq 的 CSS 变量值（如 --ls-primary-background-color）并应用到插件 UI，确保在亮色和暗色主题下正确显示。

## 技术调试备忘

- **宿主文件系统桥接限制**：插件默认只能通过 `logseq.Assets.makeSandboxStorage()` 写入自身目录，无法覆盖 `../assets/` 原始附件。若需要直接覆盖，必须运行在桌面端并通过 `window.parent.require('fs')` 获取宿主 Electron 的 `fs` 模块；在 Web 端或禁用 Node 集成时会抛出 “Host file system bridge unavailable”，此时必须退回插件自有存储。
- **写入沙盒存储的格式要求**：`IAsyncStorage.setItem` 期望字符串；直接写入 `Uint8Array` 会被转换成 Clojure Vector，导致写出的图片损坏、系统无法预览。如果必须走沙盒存储，需要先 `Blob -> base64`。
- **覆盖原图流程**：
  1. 调 `logseq.App.getCurrentGraph()` 获取图谱根目录。
  2. 解析 `../assets/...` 或 `../assets/storages/<plugin-id>/...` 得到相对路径。
  3. 使用宿主 `path.join` + `fs.promises.mkdir({recursive:true})` + `fs.promises.writeFile` 写入 `Buffer`/`Uint8Array`，保证生成的是真实二进制文件。
- **压缩结果类型兼容**：服务器可能返回 JSON（包含 `compressedUrl`）或直接返回二进制。前者可直接复用 URL；后者需要先 `response.blob()` 并生成 `data:` URL 供对比，最终仍需写回实际文件。
- **安全回退策略**：覆盖原图失败（无权限或路径无法解析）时必须打印告警并创建新的 `assets/storages/<plugin-id>/...` 文件，避免插入失败。

## 假设
- 压缩服务器是一个外部服务，能够接收图片并返回压缩版本。
- 用户有互联网访问权限与服务器通信。
- Logseq 的插件 APIs 支持必要的钩子，用于图片插入和设置。

## 范围外
- 压缩服务器本身的开发。
- 支持除图片以外的其他格式。
- 批量压缩多个图片。
