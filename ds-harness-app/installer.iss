; ============================================================
; DeepSeek Harness — Windows 一键安装器
; 用 Inno Setup 编译: ISCC.exe installer.iss
; 产物: release/DeepSeek-Harness-Setup-x64.exe
; ============================================================
#define MyAppName "DeepSeek Harness"
#define MyAppVersion "1.0.2"
#define MyAppExeName "ds-harness-app.exe"
#define MyAppPublisher "DeepSeek Harness"
#define SourceDir "E:\Claude\DSH\ds-harness-app\dist\ds-harness-app-win32-x64"
#define IconFile "E:\Claude\DSH\ds-harness-app\assets\icon.ico"

[Setup]
; 应用运行时需写 .dsh / settings.json / node_modules(自动更新)，
; 因此必须装到用户可写目录，不装 Program Files，避免权限问题
AppId={{9D5B2E7A-6C41-4F8A-9E2B-3C17D4A8F620}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
DefaultDirName={localappdata}\Programs\{#MyAppName}
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
OutputDir=E:\Claude\DSH\release
OutputBaseFilename=DeepSeek-Harness-Setup-x64
SetupIconFile={#IconFile}
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
WizardSizePercent=120
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
UninstallDisplayIcon={app}\{#MyAppExeName}
UninstallDisplayName={#MyAppName}
VersionInfoVersion={#MyAppVersion}
VersionInfoDescription={#MyAppName} 安装程序
CloseApplications=no

[Languages]
Name: "chinesesimplified"; MessagesFile: "installer-lang\ChineseSimplified.isl"
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked

[Files]
Source: "{#SourceDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{autoprograms}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Tasks: desktopicon

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "{cm:LaunchProgram,{#StringChange(MyAppName, '&', '&&')}}"; Flags: nowait postinstall skipifsilent

[UninstallDelete]
Type: filesandordirs; Name: "{app}\.dsh"
