# 呆猫桌宠 · dsh-daicat-pet

[![npm version](https://img.shields.io/npm/v/dsh-daicat-pet.svg)](https://www.npmjs.com/package/dsh-daicat-pet)

[English](README.md) | 中文

在 DeepSeek Harness 的对话界面里养一只呆猫：它会跟随会话状态变换动作；点击说一句预设台词，每轮回复结束显示本轮 **token 用量**。可以拖动、左右翻转和缩放，不占用独立窗口。

▶ **[观看效果视频](media/demo.mp4)**（1.6 MB，录屏）

> **素材许可说明：** 图集由第三方 GIF 制成。发布者表示已获公开再分发许可；但本仓库尚未附授权原文，使用或二次分发图集前请向原作者核实具体授权范围。代码的 MIT 许可证**不覆盖图集**。

## 功能一览

| 操作 / 时机 | 效果 |
| --- | --- |
| 点击呆猫 | 依次显示 `lines.json` 中的台词；再点显示下一句 |
| 拖动 | 跟手移动，按下时轻微压扁，松开回弹；位置保存在本机浏览器 |
| 移到页面左半侧 | 呆猫水平翻转；移回右半侧则恢复 |
| `Ctrl` + 滚轮 | 缩放，宽度范围 48–640 px；尺寸保存在本机浏览器 |
| 每轮回复结束 | 显示本轮 token 总数及输入、输出、缓存读取/写入四项用量，并播放完成动作 |
| 会话状态变化 | 在空闲、运行、等待交互、失败、完成待看等姿态之间切换 |

> 这里显示的是 **token 数量，不是人民币或美元账单**。如果宿主没有提供 `tokenUsage` 投影，其他桌宠功能仍可用，但不会显示本轮用量。

## 安装

### DSH Web

已发布到 npm：[`dsh-daicat-pet`](https://www.npmjs.com/package/dsh-daicat-pet)，在运行 DSH Web 的环境中执行：

```powershell
dsh plugin --profile web add dsh-daicat-pet
```

也可以从本仓库安装（与 npm 上为同一份代码，适合锁定 git 来源）：

```powershell
dsh plugin --profile web add github:Roilkl/dsh-daicat-pet
```

或者从已下载的完整源码目录安装（目录内应有 `package.json`、`lib/`、`assets/`、`cordis.patch.yml`）：

```powershell
dsh plugin --profile web add link:C:\path\to\dsh-daicat-pet
```

完成后重启 `dsh web`，再刷新页面。三种方式选其一，不要对同一包名混装。

### 官方桌面客户端

桌面客户端使用 `desktop` profile，**不是**上面命令的 `web` profile；`dsh plugin --profile desktop` 也不受 CLI 支持。请在桌面客户端中通过其内置插件管理能力，将同一个 npm 包、GitHub 仓库或完整本地包安装到当前 profile。首次安装后如未出现，完全退出客户端（包括托盘）并重开。不要为了安装而手动拷贝或删除桌面 profile 的依赖。

运行环境：Node.js `>=22.19.0`，DSH `>=0.2.0-rc.1 <0.3.0-0`；客户端绘制在 `shell.overlay` 插槽中。

## 修改台词与形象

默认台词位于 [`assets/daicat/lines.json`](assets/daicat/lines.json)，格式为 UTF-8 JSON 字符串数组：

```json
[
  "喵？在写代码吗",
  "这一轮跑完啦，看看我"
]
```

保存后刷新页面即可重新读取台词，**无需重启宿主**。如果单独使用自己的素材目录，则修改该目录下的 `lines.json`；文件缺失或格式错误时客户端使用内置的保底台词。短句更适合显示在小气泡中。

默认图集和帧表分别位于 [`assets/daicat/spritesheet.webp`](assets/daicat/spritesheet.webp)、[`assets/daicat/anim.json`](assets/daicat/anim.json)。想换自己的角色，建议在 profile 的 `cordis.patch.yml` 里按 `id` 覆盖 `petDir`，不要编辑已安装包：

```yaml
- id: daicat-pet
  name: dsh-daicat-pet
  config:
    petId: daicat
    size: 192
    petDir: C:/path/to/my-pet
```

`petDir` 应包含 `anim.json` 和 `spritesheet.webp`，`lines.json` 可选。配置优先级：显式 `petDir` → 包内 `assets/daicat` → `$DSH_HOME/desktop-pet/pets/daicat`（`$DSH_HOME` 默认为用户主目录下的 `.dsh`）。改 profile 配置或宿主代码后需重启；只改帧表、图集或台词，可刷新页面重新读取。profile 层覆盖 config 时应一起写上 `petId` 和 `size`，避免丢失原默认值。

### 图集数据格式

精灵图透明背景，按行放状态；一个格子 **192 × 208** 像素。当前内置图集 **66 列 × 9 行（12672 × 1872）**，但插件由 `anim.json` 读取行列与各动作帧数，不要求 PetDex 的固定 8 列。

```json
{
  "cell": { "w": 192, "h": 208 },
  "sheet": { "w": 1536, "h": 208, "cols": 8, "rows": 1 },
  "rows": [
    { "state": "idle", "frames": 6, "durations": [30, 30, 30, 30, 30, 30] }
  ]
}
```

`rows` 中的顺序就是图集行序；`frames` 是该状态实际使用的列数；`durations` 是逐帧时长（毫秒）。如果 `durations` 长于 `frames`，播放列按帧序号对 `frames` 取模，因此重复一段时长列表即可循环播放。内置状态名：`idle`、`running-right`、`running-left`、`waving`、`jumping`、`failed`、`waiting`、`running`、`review`。不要把上面的**格式示意**当作内置图集的完整帧表。

## 项目结构

```text
dsh-daicat-pet/
├── package.json              # 包信息与 DSH bundle/client 声明
├── cordis.patch.yml          # 宿主插件挂载配置
├── icon.svg                  # 插件图标
├── lib/
│   ├── index.js              # 宿主：资源路由、每轮 token 统计
│   └── client.js             # 页面：绘制、动画、交互、气泡
├── assets/daicat/
│   ├── anim.json              # 状态与帧时长
│   ├── spritesheet.webp      # 第三方图集（不受 MIT 许可覆盖）
│   └── lines.json             # 点击台词
├── media/demo.mp4            # 效果录屏
├── locale/                   # 中文与英文描述
├── README.md
├── README.zh.md
└── LICENSE                   # 仅限代码，不覆盖第三方美术
```

## 排查

- **装完没有出现**：确认装到了正在使用的 profile；重启宿主后刷新界面。桌面端不能用 `--profile web` 命令代替安装。
- **有猫但没动作**：检查所选 `petDir` 下的图集尺寸、`anim.json` 的行序与帧数是否匹配；不要把第三方 GIF 直接改名为 WebP。
- **没有台词**：检查 `lines.json` 是否为合法 JSON 字符串数组，刷新页面。
- **不显示本轮用量**：一轮对话须真正结束；需要 DSH 的 `sessionProjections` / `tokenUsage` 服务提供数据。这里不读取 API 余额、不计算金钱价格。
- **调试接口**：仅供本机使用，`/dsh-daicat-pet/anim.json`、`/atlas.webp`、`/api/lines`、`/api/turn`、`/api/state`；`/api/pose?set=waiting&ms=1000` 可暂时强制姿态。`/api/state` 会返回本机素材绝对路径，勿公开贴出未经脱敏的响应。

## 致谢与许可

呆猫动图素材由小黑盒用户 **「van家11451419」** 制作的「呆猫表情包合集」提供。交互与每轮气泡的设计思路参考了 [DeepSeek Balance Whale Widget](https://github.com/MeteorNOX/DeepSeek-Balance-Whale-Widget)；桌宠图集与状态组织也参考了 **dsh-desktop-pet** 的项目架构。本插件仅展示 token 数量，没有移植小鲸鱼的余额、计价或配置面板。感谢这些作品与项目的作者。

本项目**代码**按 [MIT License](LICENSE) 提供。呆猫图集及其原始 GIF 属于第三方美术，**不属于 MIT 授权范围**；发布者称已获公开再分发许可，但未在仓库提供可核对的授权原文。署名并不授予下游用户二次修改或再分发图集的权利，请向原作者核实具体许可范围。
