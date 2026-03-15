# VirtualBox 虚拟机设置指南（推荐方案）

本指南帮助您使用自动化脚本快速创建和管理 Windows 10 开发虚拟机。

> ⚠️ **重要提示**：您的系统**不支持 Hyper-V**，请使用本指南的 **VirtualBox 方案**。

## 📋 前置要求

- ✅ **VirtualBox** 已安装（https://www.virtualbox.org/wiki/Downloads）
- ✅ 已下载 Windows 10 ISO：`F:\Backup\Downloads\Win10_22H2_English_x64v1.iso`
- ✅ 至少 100GB 可用磁盘空间
- ✅ CPU 支持虚拟化（Intel VT-x 或 AMD-V）

## 🚀 快速开始（3 步）

### 步骤 1：安装 VirtualBox

1. 访问 https://www.virtualbox.org/wiki/Downloads
2. 下载 **VirtualBox for Windows hosts**
3. 运行安装程序并按照向导完成安装
4. 重启电脑

### 步骤 2：创建虚拟机

以 **PowerShell** 运行以下命令：

```powershell
cd f:\Desktop\kaifa\LTX-Desktop\scripts
powershell -ExecutionPolicy Bypass -File setup-virtualbox-vm.ps1
```

脚本会自动：
- ✅ 验证 VirtualBox 已安装
- ✅ 验证 ISO 文件完整性
- ✅ 检查磁盘空间
- ✅ 创建虚拟机（默认名称：`JianAI-Dev`）
- ✅ 配置硬件（8GB 内存，4 核 CPU，80GB 硬盘）
- ✅ 连接 ISO 到虚拟光驱
- ✅ 设置从 DVD 启动

### 步骤 3：安装 Windows 10

脚本执行完成后，选择 `Y` 立即启动虚拟机：

1. VirtualBox 管理器打开
2. 虚拟机自动启动
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

## 🎮 虚拟机管理命令

### 启动虚拟机（带 UI）

```powershell
powershell -ExecutionPolicy Bypass -File manage-virtualbox-vm.ps1 -Action gui
```

### 启动虚拟机（无 UI，后台运行）

```powershell
powershell -ExecutionPolicy Bypass -File manage-virtualbox-vm.ps1 -Action start
```

### 停止虚拟机

```powershell
powershell -ExecutionPolicy Bypass -File manage-virtualbox-vm.ps1 -Action stop
```

### 查看所有虚拟机

```powershell
powershell -ExecutionPolicy Bypass -File manage-virtualbox-vm.ps1 -Action list
```

### 查看虚拟机详细信息

```powershell
powershell -ExecutionPolicy Bypass -File manage-virtualbox-vm.ps1 -Action info
```

### 删除虚拟机

```powershell
powershell -ExecutionPolicy Bypass -File manage-virtualbox-vm.ps1 -Action delete
```

## 🔧 自定义配置

### 修改虚拟机参数

编辑 `setup-virtualbox-vm.ps1` 顶部的参数：

```powershell
param(
    [string]$VMName = "JianAI-Dev",           # 虚拟机名称
    [string]$ISOPath = "F:\Backup\Downloads\Win10_22H2_English_x64v1.iso",  # ISO 路径
    [string]$VMStoragePath = "D:\VirtualMachines",  # 存储位置
    [int]$MemoryMB = 8192,                     # 内存大小（MB）
    [int]$CPUCount = 4,                        # CPU 核心数
    [int]$DiskSizeGB = 80                      # 硬盘大小（GB）
)
```

或在命令行中指定：

```powershell
powershell -ExecutionPolicy Bypass -File setup-virtualbox-vm.ps1 `
  -VMName "MyDevVM" `
  -MemoryMB 16384 `
  -CPUCount 8 `
  -DiskSizeGB 120
```

### 更改虚拟机名称

如果您使用了自定义虚拟机名称，在管理脚本中也要指定相同的名称：

```powershell
powershell -ExecutionPolicy Bypass -File manage-virtualbox-vm.ps1 `
  -Action gui `
  -VMName "MyDevVM"
```

## 🔗 虚拟机与主机共享文件

### 方式 1：使用 VirtualBox 共享文件夹（推荐）

1. **在主机上配置共享文件夹：**
   - 在 VirtualBox 管理器中右键虚拟机 → 设置
   - 进入"共享文件夹"
   - 点击"新增"，选择要共享的主机文件夹
   - 勾选"自动挂载"

2. **在虚拟机内访问：**
   - 打开"此电脑" → 网络位置
   - 共享文件夹会自动映射为网络驱动器

### 方式 2：使用网络共享

主机上创建共享文件夹，在虚拟机内通过网络路径访问：

```
\\<主机IP>\<共享名>
```

查看主机 IP：

```powershell
# 在主机上运行
ipconfig | findstr "IPv4"
```

### 方式 3：使用剪贴板共享

1. 在 VirtualBox 管理器中进入虚拟机设置
2. 进入"常规" → "高级"
3. 设置"共享剪贴板"为"双向"
4. 设置"拖放"为"双向"

## 📊 虚拟机性能优化

### 增加内存

```powershell
VBoxManage modifyvm JianAI-Dev --memory 16384  # 改为 16GB
```

### 增加 CPU 核心数

```powershell
VBoxManage modifyvm JianAI-Dev --cpus 8  # 改为 8 核心
```

### 扩展虚拟硬盘

```powershell
VBoxManage modifymedium disk "D:\VirtualMachines\JianAI-Dev\disk.vdi" --resize 150000  # 改为 150GB
```

## 🐛 故障排除

### 问题 1：VirtualBox 安装后无法运行脚本

**原因：** VirtualBox 命令行工具未添加到 PATH

**解决方案：** 重启电脑或手动添加到 PATH

```powershell
# 查找 VBoxManage 位置
Get-Command VBoxManage
```

### 问题 2：虚拟机启动缓慢

**原因：** 内存或 CPU 分配不足

**解决方案：** 增加虚拟机资源

```powershell
VBoxManage modifyvm JianAI-Dev --memory 12288 --cpus 6
```

### 问题 3：虚拟机无法访问网络

**原因：** 网络适配器未正确配置

**解决方案：** 检查网络设置

```powershell
VBoxManage modifyvm JianAI-Dev --nic1 nat
```

### 问题 4：ISO 无法挂载

**原因：** ISO 文件损坏或路径错误

**解决方案：** 
- 检查 ISO 文件路径是否正确
- 重新下载 ISO 文件

### 问题 5：无法创建虚拟机

**原因：** VirtualBox 权限问题

**解决方案：** 以管理员身份运行 PowerShell

## 💡 最佳实践

### 1. 创建快照

在进行重要操作前创建快照，以便回滚：

```powershell
VBoxManage snapshot JianAI-Dev take "Pre-Development" --description "干净的 Windows 10 系统"
```

### 2. 恢复快照

```powershell
VBoxManage snapshot JianAI-Dev restore "Pre-Development"
```

### 3. 删除快照

```powershell
VBoxManage snapshot JianAI-Dev delete "Pre-Development"
```

### 4. 监控虚拟机资源

在 VirtualBox 管理器中选中虚拟机，查看"显示"选项卡中的实时资源使用情况

### 5. 定期备份

备份虚拟机文件到外部存储：

```powershell
Copy-Item "D:\VirtualMachines\JianAI-Dev" -Destination "E:\Backups\" -Recurse
```

## 📖 VirtualBox 常用命令参考

### 虚拟机管理

```powershell
# 列出所有虚拟机
VBoxManage list vms

# 获取虚拟机详细信息
VBoxManage showvminfo JianAI-Dev

# 启动虚拟机（带 UI）
VBoxManage startvm JianAI-Dev --type gui

# 启动虚拟机（无 UI）
VBoxManage startvm JianAI-Dev --type headless

# 停止虚拟机
VBoxManage controlvm JianAI-Dev poweroff

# 暂停虚拟机
VBoxManage controlvm JianAI-Dev pause

# 恢复虚拟机
VBoxManage controlvm JianAI-Dev resume

# 删除虚拟机
VBoxManage unregistervm JianAI-Dev --delete
```

### 快照管理

```powershell
# 列出所有快照
VBoxManage snapshot JianAI-Dev list

# 创建快照
VBoxManage snapshot JianAI-Dev take "SnapshotName" --description "Description"

# 恢复快照
VBoxManage snapshot JianAI-Dev restore "SnapshotName"

# 删除快照
VBoxManage snapshot JianAI-Dev delete "SnapshotName"
```

## 🔗 更多资源

- [VirtualBox 官方文档](https://www.virtualbox.org/manual/)
- [VirtualBox 命令行参考](https://www.virtualbox.org/manual/ch08.html)
- [Windows 10 下载](https://www.microsoft.com/zh-cn/software-download/windows10)

## 📞 获取帮助

如果遇到问题：

1. 检查脚本输出中的错误信息
2. 查看上述"故障排除"部分
3. 在 VirtualBox 管理器中检查虚拟机状态
4. 运行命令 `VBoxManage --help` 了解更多信息

---

**现在您可以开始使用 VirtualBox 了！** 🎉
