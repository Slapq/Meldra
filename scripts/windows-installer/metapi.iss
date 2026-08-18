#ifndef AppVersion
  #error AppVersion must be defined
#endif
#ifndef PayloadDir
  #error PayloadDir must be defined
#endif
#ifndef OutputDir
  #error OutputDir must be defined
#endif
#ifndef OutputBaseFilename
  #error OutputBaseFilename must be defined
#endif

#define AppName "Meldra"
#define AppPublisher "Slapq"
#define AppURL "https://github.com/Slapq/Meldra"

[Setup]
AppId={{A50C231D-6B68-4D73-946A-70D6EC066C8D}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher={#AppPublisher}
AppPublisherURL={#AppURL}
AppSupportURL={#AppURL + "/issues"}
AppUpdatesURL={#AppURL + "/releases"}
DefaultDirName={localappdata}\Programs\MetaPi
DefaultGroupName=Meldra
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0.19041
OutputDir={#OutputDir}
OutputBaseFilename={#OutputBaseFilename}
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern dynamic
SetupLogging=yes
UninstallDisplayName=Meldra
UninstallDisplayIcon={app}\pi-app.ico
SetupIconFile={#PayloadDir}\pi-app.ico
LicenseFile={#PayloadDir}\META_LICENSE.txt
ChangesEnvironment=yes
CloseApplications=no
RestartApplications=no

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Files]
Source: "{#PayloadDir}\app\*"; DestDir: "{app}\app"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "{#PayloadDir}\terminal\*"; DestDir: "{app}\terminal"; Flags: ignoreversion recursesubdirs createallsubdirs
#ifdef IncludeNode
Source: "{#PayloadDir}\runtime\*"; DestDir: "{app}\runtime"; Flags: ignoreversion recursesubdirs createallsubdirs
#endif
Source: "{#PayloadDir}\meldra.cmd"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#PayloadDir}\meldra-shell.cmd"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#PayloadDir}\meldra-onboarding.cmd"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#PayloadDir}\metapi.cmd"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#PayloadDir}\metapi-shell.cmd"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#PayloadDir}\metapi-onboarding.cmd"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#PayloadDir}\pi-app.ico"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#PayloadDir}\THIRD_PARTY_NOTICES.md"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#PayloadDir}\META_LICENSE.txt"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{userdesktop}\Meldra"; Filename: "{app}\terminal\WindowsTerminal.exe"; Parameters: "-d ""{%USERPROFILE}"" --title Meldra -- cmd.exe /d /c ""{app}\meldra-shell.cmd"""; WorkingDir: "{%USERPROFILE}"; Comment: "Meldra"; IconFilename: "{app}\pi-app.ico"

[Run]
Filename: "{app}\terminal\WindowsTerminal.exe"; Parameters: "-d ""{%USERPROFILE}"" --title ""Meldra Setup"" -- cmd.exe /d /c ""{app}\meldra-onboarding.cmd"""; WorkingDir: "{%USERPROFILE}"; Description: "{cm:LaunchProgram,Meldra}"; Flags: nowait postinstall skipifsilent

[UninstallDelete]
Type: filesandordirs; Name: "{app}\terminal\settings"
Type: dirifempty; Name: "{app}"

[Code]
#ifdef IncludeNode
const BundledNode = True;
#else
const BundledNode = False;
#endif

var
  RuntimePage: TOutputMsgWizardPage;

function HasUsableSystemNode(): Boolean;
var
  ResultCode: Integer;
begin
  Result := Exec(ExpandConstant('{cmd}'), '/d /c node.exe -e "const [a,b]=process.versions.node.split(''.'').map(Number);process.exit(a>22||(a===22&&b>=19)?0:1)"', '', SW_HIDE, ewWaitUntilTerminated, ResultCode) and (ResultCode = 0);
end;

function HasSystemNpm(): Boolean;
var
  ResultCode: Integer;
begin
  Result := Exec(ExpandConstant('{cmd}'), '/d /c npm.cmd --version >nul 2>nul', '', SW_HIDE, ewWaitUntilTerminated, ResultCode) and (ResultCode = 0);
end;

procedure InitializeWizard();
var
  MessageText: String;
begin
  if BundledNode then
    MessageText := 'This installer includes Node.js 24.19.0. No system Node.js installation is required.'
  else if HasUsableSystemNode() and HasSystemNpm() then
    MessageText := 'Compatible system Node.js and npm were detected. Meldra will use that runtime.'
  else
    MessageText := 'Compatible Node.js 22.19.0+ and npm were not both detected. Installation is still allowed. Meldra will report the missing runtime when launched; you can install Node.js later or use Meldra-Setup.exe.';
  RuntimePage := CreateOutputMsgPage(wpSelectDir, 'Runtime status', 'Meldra runtime selected for this installation', MessageText);
end;

function ComparablePath(Value: String): String;
begin
  Result := Lowercase(RemoveQuotes(Trim(Value)));
  while (Length(Result) > 3) and (Result[Length(Result)] = '\') do
    Delete(Result, Length(Result), 1);
end;

function RemovePathEntry(CurrentValue: String; Target: String): String;
var
  Part: String;
  Separator: Integer;
  Remaining: String;
begin
  Result := '';
  Remaining := CurrentValue;
  while Remaining <> '' do
  begin
    Separator := Pos(';', Remaining);
    if Separator = 0 then
    begin
      Part := Remaining;
      Remaining := '';
    end
    else
    begin
      Part := Copy(Remaining, 1, Separator - 1);
      Delete(Remaining, 1, Separator);
    end;
    if (Trim(Part) <> '') and (ComparablePath(Part) <> ComparablePath(Target)) then
    begin
      if Result <> '' then Result := Result + ';';
      Result := Result + Part;
    end;
  end;
end;

procedure AddMeldraToUserPath();
var
  AppPath: String;
  CurrentPath: String;
begin
  AppPath := ExpandConstant('{app}');
  if not RegQueryStringValue(HKCU, 'Environment', 'Path', CurrentPath) then CurrentPath := '';
  if ComparablePath(RemovePathEntry(CurrentPath, AppPath)) = ComparablePath(CurrentPath) then
  begin
    if CurrentPath = '' then CurrentPath := AppPath else CurrentPath := CurrentPath + ';' + AppPath;
    RegWriteExpandStringValue(HKCU, 'Environment', 'Path', CurrentPath);
  end;
end;

procedure RemoveMeldraFromUserPath();
var
  AppPath: String;
  CurrentPath: String;
  UpdatedPath: String;
begin
  AppPath := ExpandConstant('{app}');
  if not RegQueryStringValue(HKCU, 'Environment', 'Path', CurrentPath) then Exit;
  UpdatedPath := RemovePathEntry(CurrentPath, AppPath);
  if UpdatedPath <> CurrentPath then RegWriteExpandStringValue(HKCU, 'Environment', 'Path', UpdatedPath);
end;

procedure CurStepChanged(CurStep: TSetupStep);
begin
  if CurStep = ssPostInstall then AddMeldraToUserPath();
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
begin
  if CurUninstallStep = usUninstall then RemoveMeldraFromUserPath();
end;
