'use strict';
// 预加载脚本：保持 contextIsolation，不向页面暴露 Node 能力。
// 当前 dsh Web UI 为独立 SPA，无需桥接；此处留作后续扩展（如托盘状态同步）。
window.addEventListener('DOMContentLoaded', () => {
  // 占位：可在此向 dsh 页面注入客户端标记
});
