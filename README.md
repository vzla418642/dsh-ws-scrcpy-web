# 安卓设备台

将 [ws-scrcpy-web](https://github.com/bilbospocketses/ws-scrcpy-web) 接入 DSH Desktop，在 DSH 中查看和连接 Android 设备。

## 使用

点击左侧 **安卓设备台**。服务在线时，主区域会直接显示 ws-scrcpy-web 页面；在页面中选择设备并点击连接即可查看画面。

首次使用或服务无法访问时，页面会显示当前服务地址和连接提示。可点击提示中的 **设置地址**，或点击右上角 **⋮**，修改服务地址并保存。保存后插件会重新连接新地址。

默认地址为 `http://localhost:6902`。如果 ws-scrcpy-web 运行在其他电脑或服务器，请填写对应地址，例如 `http://192.168.1.50:8000`。插件只需服务地址；ws-scrcpy-web 可以运行在远程 Linux/ARM 服务器上。

## Agent 工具

插件提供 `ws_device` 工具，Agent 可按需调用：

- `status`：检查服务是否在线并获取版本信息。
- `devices`：列出服务当前连接的设备及其序列号、状态和型号。
- `environment`：查看服务状态和服务端可见的设备概况。
- `open_screen`：为指定设备生成独立画面链接。工具会返回链接，不会声称已自动打开画面。

设备序列号应以 `devices` 返回的值为准。独立画面链接使用 ws-scrcpy-web 的 `/embed.html` 页面，只显示设备画面。

## 服务不可用

如果页面提示服务离线：

1. 确认 ws-scrcpy-web 正在运行。
2. 检查配置的服务地址及端口是否正确，并确保 DSH 可以访问该地址。
3. 修改地址后保存，或点击重新检测。

插件不会启动、停止或管理 ws-scrcpy-web 服务，也不要求在 DSH 所在机器安装 adb。

## 许可证

本插件按 GNU GPL-3.0-only 发布，详见仓库中的 `LICENSE`。`favicon.png` 来源于 [ws-scrcpy-web](https://github.com/bilbospocketses/ws-scrcpy-web)，随上游 GPL-3.0-only 许可证分发。
