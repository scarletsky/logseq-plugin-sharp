import "@logseq/libs";

import React from "react";
import * as ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";
import { extractFirstImageInfo } from "./utils";

import { logseq as PL } from "../package.json";

// @ts-expect-error
const css = (t, ...args) => String.raw(t, ...args);

const pluginId = PL.id;

const processedBlocks = new Map<string, string>();
const blocksUnderProcessing = new Set<string>();
const previewUrlRegistry = new Map<string, Set<string>>();
let stopDbChangedListener: null | (() => void) = null;

type ComparisonSourceType = "remote" | "data-url";

type ComparisonDialogData = {
  blockUuid: string;
  originalUrl: string;
  originalPreviewUrl: string;
  compressedUrl: string;
  compressedPreviewUrl: string;
  originalSize: string;
  compressedSize: string;
  compressedSourceType: ComparisonSourceType;
  compressedMime?: string;
};

const getServerUrl = () => {
  const serverUrl = (logseq.settings?.serverUrl as string | undefined)?.trim();
  if (!serverUrl) {
    logseq.UI.showMsg("Compression server URL not configured", "warning");
    return null;
  }
  return serverUrl;
};

const extractGraphAssetPath = (url: string) => {
  if (!url) return null;
  let normalized = url.trim();
  if (!normalized) return null;

  normalized = normalized.replace(/^(?:ls-asset|assets):\/\//i, "");
  normalized = normalized.replace(/^file:\/\//i, "");

  const assetsMatch = normalized.match(/(^|\/)assets\//i);
  if (assetsMatch && assetsMatch.index !== undefined) {
    normalized = normalized.slice(assetsMatch.index);
  }

  normalized = normalized.replace(/^(\.\.\/)+/, "");
  normalized = normalized.replace(/^\.\//, "");
  normalized = normalized.replace(/^\/+/, "");

  return normalized.startsWith("assets/") ? normalized : null;
};

const MIME_MAP: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  bmp: "image/bmp",
};

const guessMimeType = (path: string) => {
  const clean = path.toLowerCase().split(/[?#]/)[0];
  const ext = clean.includes(".") ? clean.substring(clean.lastIndexOf(".") + 1) : clean;
  return MIME_MAP[ext] || "application/octet-stream";
};

const guessMimeFromUrl = (url: string) => {
  const target = url?.toLowerCase() ?? "";
  if (!target) return undefined;
  if (!target.includes(".")) return undefined;
  return guessMimeType(target);
};

const blobToDataUrl = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read blob"));
    reader.readAsDataURL(blob);
  });

const registerPreviewUrl = (blockUuid: string, url: string) => {
  if (!blockUuid || !url || !url.startsWith("blob:")) return;
  if (!previewUrlRegistry.has(blockUuid)) {
    previewUrlRegistry.set(blockUuid, new Set());
  }
  previewUrlRegistry.get(blockUuid)!.add(url);
};

const disposePreviewUrls = (blockUuid: string) => {
  const urls = previewUrlRegistry.get(blockUuid);
  if (!urls) return;
  urls.forEach((url) => URL.revokeObjectURL(url));
  previewUrlRegistry.delete(blockUuid);
};

const getGraphAssetFileUrl = async (assetPath: string) => {
  const graphInfo = await logseq.App.getCurrentGraph();
  const graphDir = graphInfo?.path;
  if (!graphDir) throw new Error("Graph path unavailable");

  const normalizedGraphDir = graphDir.replace(/\\/g, "/").replace(/\/$/, "");
  const relativePath = assetPath.replace(/^assets\//i, "");
  const absolutePath = `${normalizedGraphDir}/assets/${relativePath}`;
  const encodedPath = encodeURI(absolutePath.replace(/\\/g, "/"));
  return `file://${encodedPath.startsWith("/") ? encodedPath : `/${encodedPath}`}`;
};

const loadImageBlob = async (imageUrl: string, opts?: { blockUuid?: string }) => {
  if (!imageUrl || imageUrl.trim() === "") {
    throw new Error("Image URL is invalid");
  }

  const trimmed = imageUrl.trim();
  if (/^(https?:|data:)/i.test(trimmed)) {
    const response = await fetch(trimmed);
    if (!response.ok) throw new Error("Failed to fetch image");
    const blob = await response.blob();
    return { blob, previewUrl: trimmed };
  }

  const assetPath = extractGraphAssetPath(trimmed);
  if (!assetPath) {
    throw new Error("Unsupported image path");
  }

  const fileUrl = await getGraphAssetFileUrl(assetPath);
  const response = await fetch(fileUrl);
  if (!response.ok) throw new Error("Failed to fetch image");
  const blob = await response.blob();
  const previewUrl = URL.createObjectURL(blob);
  if (opts?.blockUuid) {
    registerPreviewUrl(opts.blockUuid, previewUrl);
  }
  return { blob, previewUrl };
};

const extractFileName = (pathOrUrl: string) => {
  if (!pathOrUrl) return "image";
  try {
    const url = new URL(pathOrUrl, "relative://");
    const pathname = url.pathname || pathOrUrl;
    const segments = pathname.split(/[\\/]/);
    const candidate = segments.pop();
    return candidate && candidate.trim() ? candidate : "image";
  } catch {
    const segments = pathOrUrl.split(/[\\/]/);
    const candidate = segments.pop();
    return candidate && candidate.trim() ? candidate : "image";
  }
};

const releaseBlock = (blockUuid: string, lastImageUrl: string | null = null) => {
  if (!blockUuid) return;
  if (lastImageUrl) {
    processedBlocks.set(blockUuid, lastImageUrl);
  } else {
    processedBlocks.delete(blockUuid);
  }
  blocksUnderProcessing.delete(blockUuid);
  disposePreviewUrls(blockUuid);
};

async function proceedWithCompression(blockUuid: string, imageUrl: string) {
  const serverUrl = getServerUrl();
  if (!serverUrl) {
    releaseBlock(blockUuid);
    return;
  }

  logseq.UI.showMsg("Compressing image...", "info");

  try {
    const block = await logseq.Editor.getBlock(blockUuid);
    if (!block) {
      releaseBlock(blockUuid);
      throw new Error("Block no longer exists");
    }

    const { blob: imageBlob, previewUrl: originalPreviewUrl } = await loadImageBlob(imageUrl, {
      blockUuid,
    });

    const formData = new FormData();
    formData.append("image", imageBlob, extractFileName(imageUrl));

    const response = await fetch(serverUrl, {
      method: "POST",
      body: formData,
    });

    if (!response.ok) throw new Error("Compression failed");

    const responseClone = response.clone();
    let parsedJson: any = null;
    try {
      parsedJson = await responseClone.json();
    } catch (jsonError) {
      parsedJson = null;
    }

    const originalSize = `${(imageBlob.size / 1024).toFixed(2)} KB`;

    if (parsedJson && parsedJson.compressedUrl) {
      const compressedSize = parsedJson.size || "Unknown";
      const compressedMime = parsedJson.mime || guessMimeFromUrl(parsedJson.compressedUrl);
      showComparisonDialog({
        blockUuid,
        originalUrl: imageUrl,
        originalPreviewUrl,
        compressedUrl: parsedJson.compressedUrl,
        compressedPreviewUrl: parsedJson.compressedPreviewUrl || parsedJson.compressedUrl,
        originalSize,
        compressedSize,
        compressedSourceType: "remote",
        compressedMime,
      });
    } else {
      const compressedBlob = await response.blob();
      if (!compressedBlob.size) throw new Error("Compression result is empty");
      const compressedSize = `${(compressedBlob.size / 1024).toFixed(2)} KB`;
      const compressedPreviewUrl = URL.createObjectURL(compressedBlob);
      registerPreviewUrl(blockUuid, compressedPreviewUrl);
      const compressedDataUrl = await blobToDataUrl(compressedBlob);

      showComparisonDialog({
        blockUuid,
        originalUrl: imageUrl,
        originalPreviewUrl,
        compressedUrl: compressedDataUrl,
        compressedPreviewUrl,
        originalSize,
        compressedSize,
        compressedSourceType: "data-url",
        compressedMime: compressedBlob.type || response.headers.get("content-type") || undefined,
      });
    }
  } catch (error) {
    logseq.UI.showMsg(`Compression failed: ${(error as Error).message}`, "error");
    releaseBlock(blockUuid);
    logseq.updateSettings({ loadingData: null });
  }
}

function showComparisonDialog(comparisonData: ComparisonDialogData) {
  logseq.updateSettings({
    comparisonData,
    loadingData: null,
  });
  logseq.showMainUI();
}

async function handleImageInsertion(block: any) {
  if (!block?.uuid || !block?.content) return;
  if (blocksUnderProcessing.has(block.uuid)) return;

  const imageInfo = extractFirstImageInfo(block.content);
  if (!imageInfo?.url) return;

  const serverUrl = getServerUrl();
  if (!serverUrl) return;

  const lastHandledUrl = processedBlocks.get(block.uuid);
  if (lastHandledUrl === imageInfo.url) return;

  blocksUnderProcessing.add(block.uuid);
  processedBlocks.set(block.uuid, imageInfo.url);

  logseq.updateSettings({
    confirmationData: {
      blockUuid: block.uuid,
      imageUrl: imageInfo.url,
    },
    comparisonData: null,
    loadingData: null,
  });
  logseq.showMainUI();
}

function setupBlockWatcher() {
  stopDbChangedListener?.();
  stopDbChangedListener = logseq.DB.onChanged(async ({ blocks }) => {
    if (!Array.isArray(blocks)) return;
    for (const block of blocks) {
      await handleImageInsertion(block);
    }
  });
}

function main() {
console.info(`#${pluginId}: MAIN`);
const root = ReactDOM.createRoot(document.getElementById("app")!);

root.render(
<React.StrictMode>
    <App />
    </React.StrictMode>
);

function createModel() {
  return {
      show() {
      logseq.showMainUI();
    },
};
}

logseq.provideModel(createModel());
logseq.setMainUIInlineStyle({
zIndex: 11,
});

  // Settings schema
logseq.useSettingsSchema([
  {
  key: "serverUrl",
  type: "string",
title: "Compression Server URL",
description: "URL of the server that handles image compression",
default: "",
},
]);

logseq.updateSettings({
  confirmationData: null,
  comparisonData: null,
  loadingData: null,
  proceedCompression: null,
  flowCompletion: null,
});

setupBlockWatcher();

const openIconName = "template-plugin-open";

logseq.provideStyle(css`
    .${openIconName} {
    opacity: 0.55;
  font-size: 20px;
  margin-top: 4px;
}

.${openIconName}:hover {
      opacity: 0.9;
  }
  `);

  logseq.App.registerUIItem("toolbar", {
  key: openIconName,
template: `
<a data-on-click="show">
  <div class="${openIconName}">⚙️</div>
</a>
`,
  });
}

// Listen for proceedCompression
logseq.on("settings:changed", (settings) => {
  const proceedPayload = settings.proceedCompression;
  if (proceedPayload?.blockUuid && proceedPayload?.imageUrl) {
    proceedWithCompression(proceedPayload.blockUuid as string, proceedPayload.imageUrl as string);
    logseq.updateSettings({ proceedCompression: null });
  }

  const completionPayload = settings.flowCompletion;
  if (completionPayload?.blockUuid) {
    releaseBlock(
      completionPayload.blockUuid as string,
      (completionPayload.lastImageUrl as string | undefined) ?? null,
    );
    logseq.updateSettings({ flowCompletion: null });
  }
});

logseq.ready(main).catch(console.error);
