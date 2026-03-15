# Hyper-V 虚拟机设置指南

本指南帮助您使用自动化脚本快速创建和管理 Windows 10 开发虚拟机。

## 📋 前置要求

- ✅ Windows 10 **专业版**、企业版或教育版（家庭版不支持 Hyper-V）
- ✅ 已下载 Windows 10 ISO：`F:\Backup\Downloads\Win10_22H2_English_x64v1.iso`
- ✅ 至少 100GB 可用磁盘空间
- ✅ 管理员权限
- ✅ CPU 支持虚拟化（Intel VT-x 或 AMD-V）

## 🚀 快速开始

### 步骤 1：启用 Hyper-V

如果您还未启用 Hyper-V，以管理员身份运行 PowerShell：

```powershell
Enable-WindowsOptionalFeature -FeatureName Hyper-V -All -Online
```

系统会要求重启。重启后再继续下一步。

### 步骤 2：创建虚拟机

以**管理员身份**打开 PowerShell，运行：

```powershell
cd f:\Desktop\kaifa\LTX-Desktop\scripts
powershell -ExecutionPolicy Bypass -File setup-hyperv-vm.ps1
```

脚本会自动：
- ✅ 验证管理员权限
- ✅ 检查 Hyper-V 是否启用
- ✅ 验证 ISO 文件完整性
- ✅ 检查磁盘空间
- ✅ 创建虚拟机（默认名称：`JianAI-Dev`）
- ✅ 配置硬件（8GB 内存，4 核 CPU，80GB 硬盘）
- ✅ 连接 ISO 到虚拟光驱
- ✅ 设置从 DVD 启动

### 步骤 3：安装 Windows 10

脚本执行完成后，它会询问是否立即启动虚拟机。选择 `Y` 后：

1. 虚拟机启动
2. Hyper-V 连接工具自动打开
3. 按照 Windows 10 安装向导完成系统安装
4. 安装时间：15-30 分钟（取决于系统性能）

**安装建议：**
- 选择"自定义安装"
- 选择虚拟硬盘进行安装
- 安装完成后立即更新驱动和系统补丁

### 步骤 4：配置开发环境

安装完成后，在虚拟机内：

1. 复制项目文件夹到虚拟机（可使用共享文件夹或网络共享）
2. 在虚拟机内运行：

```powershell
cd path\to\LTX-Desktop\scripts
powershell -ExecutionPolicy Bypass -File setup-dev.ps1
```

这会自动安装：
- Node.js 18+
- Python 3.12+
- 项目依赖
- 必要的开发工具

## 🎮 虚拟机管理命令

### 快速启动虚拟机

```powershell
powershell -ExecutionPolicy Bypass -File manage-hyperv-vm.ps1 -Action start
```

### 连接到虚拟机

```powershell
powershell -ExecutionPolicy Bypass -File manage-hyperv-vm.ps1 -Action connect
```

如果虚拟机未运行，此命令会自动启动它。

### 停止虚拟机

```powershell
powershell -ExecutionPolicy Bypass -File manage-hyperv-vm.ps1 -Action stop
```

### 查看所有虚拟机

```powershell
powershell -ExecutionPolicy Bypass -File manage-hyperv-vm.ps1 -Action list
```

### 查看虚拟机详细信息

```powershell
powershell -ExecutionPolicy Bypass -File manage-hyperv-vm.ps1 -Action info
```

### 删除虚拟机

```powershell
powershell -ExecutionPolicy Bypass -File manage-hyperv-vm.ps1 -Action delete
```

## 🔧 自定义配置

### 修改虚拟机参数

编辑 `setup-hyperv-vm.ps1` 顶部的参数：

```powershell
param(
    [string]$VMName = "JianAI-Dev",           # 虚拟机名称
    [string]$ISOPath = "F:\Backup\Downloads\Win10_22H2_English_x64v1.iso",  # ISO 路径
    [string]$VMStoragePath = "D:\VirtualMachines",  # 存储位置
    [int]$MemoryGB = 8,                        # 内存大小（GB）
    [int]$ProcessorCount = 4,                  # CPU 核心数
    [int]$DiskSizeGB = 80                      # 硬盘大小（GB）
)
```

或在命令行中指定：

```powershell
powershell -ExecutionPolicy Bypass -File setup-hyperv-vm.ps1 `
  -VMName "MyDevVM" `
  -MemoryGB 16 `
  -ProcessorCount 8 `
  -DiskSizeGB 120
```

### 更改虚拟机名称

如果您使用了自定义虚拟机名称，在管理脚本中也要指定相同的名称：

```powershell
powershell -ExecutionPolicy Bypass -File manage-hyperv-vm.ps1 `
  -Action connect `
  -VMName "MyDevVM"
```

## 🔗 虚拟机与主机共享文件

### 方式 1：使用 Hyper-V 增强会话（推荐）

1. 在虚拟机内启用增强会话模式
2. 在 Hyper-V 连接工具中可以共享剪贴板、驱动器等

### 方式 2：使用网络共享

主机上创建共享文件夹，在虚拟机内通过网络路径访问：

```
\\<主机IP>\<共享名>
```

### 方式 3：使用虚拟机快照共享

创建虚拟磁盘并挂载到虚拟机，用于大文件传输。

## 📊 虚拟机性能优化

### 增加内存（如果主机有足够资源）

```powershell
Set-VM -Name JianAI-Dev -MemoryStartupBytes 16GB
```

### 增加 CPU 核心数

```powershell
Set-VMProcessor -VMName JianAI-Dev -Count 8
```

### 启用动态内存

脚本已默认启用，最小 2GB，最大为指定的 MemoryGB 值。

### 扩展虚拟硬盘

```powershell
$disk = Get-VMHardDiskDrive -VMName JianAI-Dev | Select-Object -First 1
Resize-VHD -Path $disk.Path -SizeBytes 150GB
```

## 🐛 故障排除

### 问题 1：Hyper-V 功能不可用

**原因：** Windows 版本不支持（如家庭版）

**解决方案：** 升级到 Windows 10 专业版或使用 VirtualBox

```powershell
# 检查 Windows 版本
Get-ComputerInfo | Select-Object OsName
```

### 问题 2：虚拟化未启用

**原因：** CPU 虚拟化或 BIOS 设置未启用

**解决方案：** 重启进入 BIOS 设置，启用虚拟化选项（VT-x / AMD-V）

### 问题 3：ISO 无法挂载

**原因：** ISO 文件损坏或路径错误

**解决方案：** 
- 检查 ISO 文件完整性：`certutil -hashfile <path> SHA256`
- 重新下载 ISO 文件

### 问题 4：虚拟机启动缓慢

**原因：** 内存或 CPU 分配不足

**解决方案：** 增加虚拟机内存和 CPU 核心数

```powershell
Set-VM -Name JianAI-Dev -MemoryStartupBytes 12GB
Set-VMProcessor -VMName JianAI-Dev -Count 6
```

### 问题 5：无法连接到虚拟机

**原因：** Hyper-V 连接工具未正确启动

**解决方案：** 手动启动

```powershell
vmconnect.exe localhost JianAI-Dev
```

## 💡 最佳实践

### 1. 定期创建快照

在进行重要操作前创建快照，以便回滚：

```powershell
Checkpoint-VM -Name JianAI-Dev -SnapshotName "Pre-Development"
```

### 2. 监控虚拟机资源

查看虚拟机当前资源使用情况：

```powershell
Get-VM JianAI-Dev | Select-Object Name, ProcessorCount, MemoryAssigned, MemoryDemand
```

### 3. 定期备份

备份虚拟机文件到外部存储：

```powershell
Copy-Item "D:\VirtualMachines\JianAI-Dev" -Destination "E:\Backups\" -Recurse
```

### 4. 设置固定 IP（可选）

在虚拟机内设置静态 IP，便于网络访问：

```powershell
# 在虚拟机内运行
netsh interface ipv4 set address "Ethernet" static 192.168.1.100 255.255.255.0 192.168.1.1
```

### 5. 启用 Guest Additions

安装 Hyper-V 集成服务，提升虚拟机性能和兼容性：

```powershell
# 在虚拟机内运行
Add-WindowsFeature Hyper-V-Guest-Service-Integration
```

## 📖 相关命令参考

### Hyper-V PowerShell 常用命令

```powershell
# 列出所有虚拟机
Get-VM

# 获取虚拟机详细信息
Get-VM -Name JianAI-Dev | Format-List

# 启动虚拟机
Start-VM -Name JianAI-Dev

# 停止虚拟机
Stop-VM -Name JianAI-Dev -Force

# 暂停虚拟机
Suspend-VM -Name JianAI-Dev

# 恢复虚拟机
Resume-VM -Name JianAI-Dev

# 删除虚拟机
Remove-VM -Name JianAI-Dev -Force

# 创建快照
Checkpoint-VM -Name JianAI-Dev -SnapshotName "MySnapshot"

# 恢复快照
Restore-VMSnapshot -Name "MySnapshot" -VM (Get-VM -Name JianAI-Dev) -Confirm:$false

# 删除快照
Remove-VMSnapshot -Name "MySnapshot" -VM (Get-VM -Name JianAI-Dev)
```

## 🔗 更多资源

- [Microsoft Hyper-V 官方文档](https://learn.microsoft.com/zh-cn/windows-server/virtualization/hyper-v/hyper-v-on-windows)
- [PowerShell Hyper-V 模块](https://learn.microsoft.com/zh-cn/powershell/module/hyper-v/)
- [Windows 10 下载](https://www.microsoft.com/zh-cn/software-download/windows10)

## 📞 获取帮助

如果遇到问题：

1. 检查 PowerShell 输出中的错误信息
2. 查看上述"故障排除"部分
3. 在虚拟机创建过程中注意脚本的提示
4. 运行 `Get-Help <命令>` 了解 PowerShell 命令的详细用法

---

**提示：** 所有脚本都必须以**管理员身份**运行！
