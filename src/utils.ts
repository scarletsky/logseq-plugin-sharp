import { LSPluginUserEvents } from "@logseq/libs/dist/LSPlugin.user";
import React from "react";

let _visible = logseq.isMainUIVisible;

function subscribeLogseqEvent<T extends LSPluginUserEvents>(
  eventName: T,
  handler: (...args: any) => void
) {
  logseq.on(eventName, handler);
  return () => {
    logseq.off(eventName, handler);
  };
}

const subscribeToUIVisible = (onChange: () => void) =>
  subscribeLogseqEvent("ui:visible:changed", ({ visible }) => {
    _visible = visible;
    onChange();
  });

export const useAppVisible = () => {
  return React.useSyncExternalStore(subscribeToUIVisible, () => _visible);
};

export const IMAGE_MARKDOWN_REGEXP = /!\[([^\]]*)\]\(([^)]+)\)/m;

export const extractFirstImageInfo = (content?: string | null) => {
  if (!content) return null;
  const match = content.match(IMAGE_MARKDOWN_REGEXP);
  if (!match) return null;
  const [, alt = "", url = ""] = match;
  return {
    markdown: match[0],
    alt,
    url,
  };
};

export const replaceFirstImageUrl = (content: string, newUrl: string) => {
  if (!content) return content;
  return content.replace(
    IMAGE_MARKDOWN_REGEXP,
    (_match, alt = "") => `![${alt}](${newUrl})`
  );
};

export const dataUrlToBlob = (dataUrl: string) => {
  const matches = dataUrl.match(/^data:(.*?);base64,(.*)$/);
  const mime = matches?.[1];
  const base64 = matches?.[2] ?? dataUrl;
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i += 1) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return new Blob([bytes], mime ? { type: mime } : undefined);
};

export const blobToBase64 = (
  blob: Blob,
  opts: {
    stripDataUrlPrefix?: boolean;
  } = {}
) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result as string;
      if (opts.stripDataUrlPrefix === false) {
        resolve(result);
        return;
      }
      const base64 = result.includes(",")
        ? result.split(",").pop() || ""
        : result;
      resolve(base64);
    };
    reader.onerror = () =>
      reject(reader.error ?? new Error("Failed to read blob"));
    reader.readAsDataURL(blob);
  });

const EXTENSION_FROM_MIME: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/svg+xml": "svg",
  "image/bmp": "bmp",
};

export const guessExtensionFromMime = (
  mime?: string,
  fallbackName?: string
) => {
  if (mime && EXTENSION_FROM_MIME[mime]) return EXTENSION_FROM_MIME[mime];
  if (fallbackName) {
    const clean = fallbackName.split(/[?#]/)[0];
    const ext = clean.includes(".")
      ? clean.substring(clean.lastIndexOf(".") + 1)
      : "";
    if (ext) return ext.toLowerCase();
  }
  return "png";
};

export const decodeFileNameSegment = (input?: string | null) => {
  if (!input) return null;
  try {
    return decodeURIComponent(input);
  } catch {
    return input;
  }
};

export const encodeFileNameSegment = (input: string) =>
  encodeURIComponent(input);
