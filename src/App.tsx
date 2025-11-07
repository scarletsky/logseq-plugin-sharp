import React, { useRef, useState, useEffect } from "react";
import type { IAsyncStorage } from "@logseq/libs/dist/modules/LSPlugin.Storage";
import { logseq as PL } from "../package.json";
import {
  useAppVisible,
  replaceFirstImageUrl,
  dataUrlToBlob,
  guessExtensionFromMime,
} from "./utils";

type BinaryFriendlyStorage = IAsyncStorage & {
  setItem(key: string, value: string | Uint8Array): Promise<void>;
};

let assetsStorage: BinaryFriendlyStorage | null = null;

const ensureAssetsStorage = () => {
  if (!assetsStorage) {
    assetsStorage = logseq.Assets.makeSandboxStorage() as BinaryFriendlyStorage;
  }
  return assetsStorage;
};

const pluginAssetsPrefix = `assets/storages/${PL.id}/`;

const normalizeAssetsRelativePath = (input?: string) => {
  if (!input) return null;
  let normalized = input.trim();
  if (!normalized) return null;
  normalized = normalized.replace(/^ls-asset:\/\//i, "");
  normalized = normalized.replace(/^assets:\/\//i, "");
  normalized = normalized.replace(/^file:\/\//i, "");
  const assetsMatch = normalized.match(/(^|\/)assets\//i);
  if (assetsMatch?.index !== undefined) {
    normalized = normalized.slice(assetsMatch.index);
  }
  normalized = normalized.replace(/^(\.\.\/)+/, "");
  normalized = normalized.replace(/^\.\//, "");
  normalized = normalized.replace(/^\/+/, "");
  if (!normalized.toLowerCase().startsWith("assets/")) return null;
  return normalized;
};

const extractFileNameFromUrl = (url?: string) => {
  if (!url) return null;
  const trimmed = url.trim();
  if (!trimmed || /^data:/i.test(trimmed)) return null;
  const clean = trimmed.split(/[?#]/)[0];
  const segments = clean.split(/[\\/]/);
  const candidate = segments.pop();
  if (!candidate) return null;
  return candidate.trim() || null;
};

const computeStorageKeyForAsset = (normalizedAssetPath: string) => {
  if (!normalizedAssetPath || !normalizedAssetPath.startsWith("assets/"))
    return null;
  const sanitize = (path: string) =>
    path.replace(/\/+$/i, "").split("/").filter(Boolean);
  const fromSegments = sanitize(pluginAssetsPrefix);
  const toSegments = sanitize(normalizedAssetPath);
  if (!toSegments.length) return null;
  let idx = 0;
  while (idx < fromSegments.length && idx < toSegments.length) {
    if (fromSegments[idx].toLowerCase() !== toSegments[idx].toLowerCase()) {
      break;
    }
    idx += 1;
  }
  const upSegments = fromSegments.slice(idx).map(() => "..");
  const downSegments = toSegments.slice(idx);
  const relativeSegments = [...upSegments, ...downSegments];
  if (!relativeSegments.length) return null;
  return relativeSegments.join("/");
};

const saveBlobToAssets = async (
  blob: Blob,
  mimeHint?: string,
  sourceUrl?: string,
  originalAssetUrl?: string
) => {
  const storage = ensureAssetsStorage();
  const ext = guessExtensionFromMime(mimeHint || blob.type, sourceUrl);
  const normalizedAssetPath = normalizeAssetsRelativePath(originalAssetUrl);
  const preferredRelativePath = normalizedAssetPath
    ? `../${normalizedAssetPath}`
    : null;
  const traversalKey = normalizedAssetPath
    ? computeStorageKeyForAsset(normalizedAssetPath)
    : null;
  const hasExtension = (name?: string | null) =>
    !!name && /\.[a-z0-9]+$/i.test(name);
  const originalFileName = extractFileNameFromUrl(
    originalAssetUrl || sourceUrl
  );
  const fallbackFilename = hasExtension(originalFileName)
    ? (originalFileName as string)
    : `${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const fallbackRelativePath = `../assets/storages/${PL.id}/${fallbackFilename}`;
  const payload = new Uint8Array(await blob.arrayBuffer());

  debugger;

  if (preferredRelativePath && traversalKey) {
    try {
      await storage.setItem(traversalKey, payload);
      return preferredRelativePath;
    } catch (error) {
      console.warn(
        "Failed to write compressed image to original asset path:",
        error
      );
    }
  }

  await storage.setItem(fallbackFilename, payload);
  return fallbackRelativePath;
};

function App() {
  const innerRef = useRef<HTMLDivElement>(null);
  const visible = useAppVisible();
  const [comparisonData, setComparisonData] = useState<any>(null);
  const [confirmationData, setConfirmationData] = useState<any>(null);
  const [loadingData, setLoadingData] = useState<any>(null);
  const [themeVars, setThemeVars] = useState<any>({});

  useEffect(() => {
    // Get theme variables from parent document
    const getThemeVars = () => {
      try {
        const parentDoc = window.parent?.document;
        if (parentDoc) {
          const computedStyle = getComputedStyle(parentDoc.documentElement);
          return {
            primaryBg:
              computedStyle
                .getPropertyValue("--ls-primary-background-color")
                .trim() || "#ffffff",
            primaryText:
              computedStyle
                .getPropertyValue("--ls-primary-text-color")
                .trim() || "#000000",
            primaryBtnBg:
              computedStyle
                .getPropertyValue("--ls-primary-button-background")
                .trim() || "#3b82f6",
            primaryBtnColor:
              computedStyle
                .getPropertyValue("--ls-primary-button-color")
                .trim() || "#ffffff",
            secondaryBtnBg:
              computedStyle
                .getPropertyValue("--ls-secondary-button-background")
                .trim() || "#d1d5db",
            secondaryBtnColor:
              computedStyle
                .getPropertyValue("--ls-secondary-button-color")
                .trim() || "#374151",
          };
        }
      } catch (e) {
        console.warn("Failed to get theme vars from parent:", e);
      }
      return {
        primaryBg: "#ffffff",
        primaryText: "#000000",
        primaryBtnBg: "#3b82f6",
        primaryBtnColor: "#ffffff",
        secondaryBtnBg: "#d1d5db",
        secondaryBtnColor: "#374151",
      };
    };

    setThemeVars(getThemeVars());

    // Listen for settings changes
    const handler = (settings: any) => {
      setComparisonData(settings.comparisonData ?? null);
      setConfirmationData(settings.confirmationData ?? null);
      setLoadingData(settings.loadingData ?? null);
    };
    logseq.on("settings:changed", handler);
    // Initial check
    if (logseq.settings?.comparisonData) {
      setComparisonData(logseq.settings.comparisonData);
    } else if (logseq.settings?.confirmationData) {
      setConfirmationData(logseq.settings.confirmationData);
    } else if (logseq.settings?.loadingData) {
      setLoadingData(logseq.settings.loadingData);
    }
    return () => {
      logseq.off("settings:changed", handler);
    };
  }, []);

  const persistCompressedImage = async () => {
    if (!comparisonData?.compressedUrl)
      throw new Error("No compressed image available");
    const sourceType = (comparisonData.compressedSourceType ?? "remote") as
      | "remote"
      | "data-url";
    let blob: Blob;
    if (sourceType === "data-url") {
      blob = dataUrlToBlob(comparisonData.compressedUrl);
    } else {
      const response = await fetch(comparisonData.compressedUrl);
      if (!response.ok) throw new Error("Failed to download compressed image");
      blob = await response.blob();
    }
    return saveBlobToAssets(
      blob,
      comparisonData.compressedMime,
      comparisonData.compressedUrl,
      comparisonData.originalUrl
    );
  };

  const handleSelectImage = async (choice: "original" | "compressed") => {
    if (!comparisonData) return;
    try {
      const blockUuid = comparisonData.blockUuid;
      const isOriginal = choice === "original";
      const finalUrl = isOriginal
        ? comparisonData.originalUrl
        : await persistCompressedImage();

      logseq.updateSettings({
        comparisonData: null,
        flowCompletion: { blockUuid, lastImageUrl: finalUrl },
      });
      setComparisonData(null);

      const block = await logseq.Editor.getBlock(blockUuid);
      if (block?.content) {
        const newContent = replaceFirstImageUrl(block.content, finalUrl);
        await logseq.Editor.updateBlock(blockUuid, newContent);
      }

      logseq.hideMainUI();
    } catch (error) {
      console.error(error);
      logseq.UI.showMsg(
        `Failed to insert image: ${(error as Error).message}`,
        "error"
      );
    }
  };

  const handleConfirmCompression = () => {
    if (!confirmationData) return;

    // Call proceedWithCompression
    // Since it's global, we need to expose it or use provideModel
    logseq.updateSettings({
      confirmationData: null,
      loadingData: { blockUuid: confirmationData.blockUuid },
      proceedCompression: confirmationData,
    });
    setConfirmationData(null);
  };

  const handleCancelCompression = () => {
    if (!confirmationData) return;
    logseq.updateSettings({
      confirmationData: null,
      flowCompletion: {
        blockUuid: confirmationData.blockUuid,
        lastImageUrl: confirmationData.imageUrl,
      },
    });
    setConfirmationData(null);
    logseq.hideMainUI();
  };

  if (visible) {
    if (comparisonData) {
      return (
        <main className="backdrop-filter backdrop-blur-md fixed inset-0 flex items-center justify-center">
          <div
            ref={innerRef}
            style={{
              background: themeVars.primaryBg,
              color: themeVars.primaryText,
              padding: "1.5rem",
              borderRadius: "0.5rem",
              boxShadow:
                "0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)",
              maxWidth: "56rem",
              width: "100%",
              margin: "0 1rem",
            }}
          >
            <h2 className="text-xl font-bold mb-4">Choose Image</h2>
            <div className="flex space-x-4">
              <div className="flex-1 text-center">
                <h3 className="font-semibold">
                  Original ({comparisonData.originalSize})
                </h3>
                <img
                  src={
                    comparisonData.originalPreviewUrl ||
                    comparisonData.originalUrl
                  }
                  alt="Original"
                  className="max-w-full h-auto border rounded"
                />
                <button
                  onClick={() => handleSelectImage("original")}
                  style={{
                    marginTop: "0.5rem",
                    padding: "0.5rem 1rem",
                    background: themeVars.primaryBtnBg,
                    color: themeVars.primaryBtnColor,
                    borderRadius: "0.25rem",
                  }}
                >
                  Select Original
                </button>
              </div>
              <div className="flex-1 text-center">
                <h3 className="font-semibold">
                  Compressed ({comparisonData.compressedSize})
                </h3>
                <img
                  src={
                    comparisonData.compressedPreviewUrl ||
                    comparisonData.compressedUrl
                  }
                  alt="Compressed"
                  className="max-w-full h-auto border rounded"
                />
                <button
                  onClick={() => handleSelectImage("compressed")}
                  style={{
                    marginTop: "0.5rem",
                    padding: "0.5rem 1rem",
                    background: themeVars.primaryBtnBg,
                    color: themeVars.primaryBtnColor,
                    borderRadius: "0.25rem",
                  }}
                >
                  Select Compressed
                </button>
              </div>
            </div>
          </div>
        </main>
      );
    } else if (confirmationData) {
      return (
        <main className="backdrop-filter backdrop-blur-md fixed inset-0 flex items-center justify-center">
          <div
            ref={innerRef}
            style={{
              background: themeVars.primaryBg,
              color: themeVars.primaryText,
              padding: "1.5rem",
              borderRadius: "0.5rem",
              boxShadow:
                "0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)",
              maxWidth: "28rem",
              width: "100%",
              margin: "0 1rem",
            }}
          >
            <h2 className="text-xl font-bold mb-2">Compress Image?</h2>
            <div className="mb-4 space-y-3">
              <p>Do you want to compress this image before inserting?</p>
              <code
                style={{
                  display: "block",
                  wordBreak: "break-all",
                  fontSize: "0.85rem",
                  color: themeVars.secondaryBtnColor,
                }}
              >
                {confirmationData.imageUrl}
              </code>
            </div>
            <div className="flex justify-end space-x-2">
              <button
                onClick={handleCancelCompression}
                style={{
                  padding: "0.5rem 1rem",
                  background: themeVars.secondaryBtnBg,
                  color: themeVars.secondaryBtnColor,
                  borderRadius: "0.25rem",
                }}
              >
                Skip
              </button>
              <button
                onClick={handleConfirmCompression}
                style={{
                  padding: "0.5rem 1rem",
                  background: themeVars.primaryBtnBg,
                  color: themeVars.primaryBtnColor,
                  borderRadius: "0.25rem",
                }}
              >
                Compress
              </button>
            </div>
          </div>
        </main>
      );
    } else if (loadingData) {
      return (
        <main className="backdrop-filter backdrop-blur-md fixed inset-0 flex items-center justify-center">
          <div
            ref={innerRef}
            style={{
              background: themeVars.primaryBg,
              color: themeVars.primaryText,
              padding: "1.5rem",
              borderRadius: "0.5rem",
              boxShadow:
                "0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)",
              maxWidth: "20rem",
              width: "100%",
              margin: "0 1rem",
              textAlign: "center",
            }}
          >
            <h2 className="text-xl font-bold mb-2">Compressing...</h2>
            <p>Please wait while we optimize your image.</p>
          </div>
        </main>
      );
    } else {
      return (
        <main
          className="backdrop-filter backdrop-blur-md fixed inset-0 flex items-center justify-center"
          onClick={(e) => {
            if (!innerRef.current?.contains(e.target as any)) {
              logseq.hideMainUI();
            }
          }}
        >
          <div ref={innerRef} className="text-size-2em">
            Welcome to [[Logseq]] Plugins!
          </div>
        </main>
      );
    }
  }
  return null;
}

export default App;
