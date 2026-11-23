// The operating system, for texts that name it ("As in Windows"). The webview's
// user agent tells: WebView2 reports Windows, WebKitGTK Linux.

/** "Windows" or "Linux". */
export const SYSTEM_NAME = typeof navigator !== "undefined" && navigator.userAgent.includes("Windows") ? "Windows" : "Linux";
