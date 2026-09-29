┌─────────────────────────────────────────────────────────────┐
│  ARCHIVE — панtheon-ui-tauri-legacy                         │
│                                                             │
│  Это LEGACY-версия UI на Tauri 2 + WebKitGTK.               │
│  Активный UI-стек: ui/mayak-ui (GPUIX, React → GPUI).       │
│                                                             │
│  Скрипты сборки: packaging/build-pkg.sh (помечен LEGACY).   │
│  НЕ править новые фичи здесь. Только reference для чтения.  │
│                                                             │
│  Известные проблемы WebKitGTK, устранённые в mayak-ui:      │
│  - WEBKIT_DISABLE_DMABUF_RENDERER (NVIDIA+Hyprland)         │
│  - Origin 403 при WS-handshake (tauri://localhost)          │
│  - Ctrl+V через wl-paste (ClipboardEvent не работает)       │
│  - HTML5 DnD ненадёжен → onDragDropEvent                    │
│                                                             │
│  Дата архивации: 2026-09-29                                 │
└─────────────────────────────────────────────────────────────┘
