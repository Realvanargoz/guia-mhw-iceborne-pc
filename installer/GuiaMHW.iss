; Instalador de Guía MHW Iceborne · PC (Inno Setup 6).
;   ISCC.exe installer\GuiaMHW.iss /DAppVersion=0.1.0
; Entrada: dist\GuiaMHW (la misma carpeta validada por scripts/check_package.py; SIN portable.txt, así que los datos
; van a %LOCALAPPDATA%\GuiaMHW). Instalación POR USUARIO, sin permisos de administrador, sin servicios, tareas,
; arranque automático, reglas de firewall ni cambios en el PATH. La única clave de registro es la de desinstalación.
#ifndef AppVersion
  #define AppVersion "0.1.0"
#endif

[Setup]
AppId={{6F0B3C52-7A1D-4E55-9C0E-2B8D4A1F7E31}
AppName=Guía MHW Iceborne
AppVersion={#AppVersion}
AppVerName=Guía MHW Iceborne {#AppVersion}
AppPublisher=Realvanargoz · proyecto de código abierto (MIT)
AppPublisherURL=https://github.com/Realvanargoz/guia-mhw-iceborne-pc
AppSupportURL=https://github.com/Realvanargoz/guia-mhw-iceborne-pc/issues
AppUpdatesURL=https://github.com/Realvanargoz/guia-mhw-iceborne-pc/releases
AppContact=info@asesoriatics.com
AppCopyright=Código y textos originales: licencia MIT. Monster Hunter es marca de CAPCOM CO., LTD.
AppComments=Guía no oficial y gratuita de Monster Hunter: World + Iceborne para PC. Funciona sin internet y no está afiliada a Capcom, Valve ni Steam.
DefaultDirName={autopf}\GuiaMHW
DefaultGroupName=Guía MHW
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog
OutputDir=..\dist
OutputBaseFilename=GuiaMHW-{#AppVersion}-setup
SetupIconFile=guiamhw.ico
UninstallDisplayIcon={app}\GuiaMHW.exe
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
CloseApplications=yes
RestartApplications=no
UsedUserAreasWarning=no
VersionInfoVersion={#AppVersion}
VersionInfoDescription=Guía MHW Iceborne · PC (instalador)
VersionInfoCompany=Realvanargoz (código abierto, MIT)
VersionInfoProductName=Guía MHW Iceborne
VersionInfoProductVersion={#AppVersion}
VersionInfoCopyright=MIT. Monster Hunter es marca de CAPCOM CO., LTD.

[Languages]
Name: "spanish"; MessagesFile: "compiler:Languages\Spanish.isl"

[Tasks]
Name: "desktopicon"; Description: "Crear un acceso directo en el escritorio"; GroupDescription: "Accesos directos:"; Flags: unchecked

[Files]
Source: "..\dist\GuiaMHW\*"; DestDir: "{app}"; Flags: recursesubdirs createallsubdirs ignoreversion
Source: "..\THIRD_PARTY_NOTICES.txt"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\LICENSE"; DestDir: "{app}"; DestName: "LICENSE.txt"; Flags: ignoreversion
Source: "..\CHANGELOG.txt"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\CHANGELOG.txt"; DestDir: "{tmp}"; Flags: dontcopy

[Icons]
Name: "{autoprograms}\Guía MHW"; Filename: "{app}\GuiaMHW.exe"
Name: "{autodesktop}\Guía MHW"; Filename: "{app}\GuiaMHW.exe"; Tasks: desktopicon

[Run]
Filename: "{app}\GuiaMHW.exe"; Description: "Abrir Guía MHW ahora"; Flags: nowait postinstall skipifsilent

[Code]
var
  NewsPage: TOutputMsgMemoWizardPage;
  NewsText: String;

// Parte N (0 = mayor, 1 = menor, 2 = parche) de una versión "a.b.c[.d]".
function VerPart(const V: String; Index: Integer): Integer;
var
  S: String;
  I, P: Integer;
begin
  S := V;
  for I := 1 to Index do
  begin
    P := Pos('.', S);
    if P = 0 then
    begin
      Result := 0;
      Exit;
    end;
    S := Copy(S, P + 1, Length(S));
  end;
  P := Pos('.', S);
  if P > 0 then
    S := Copy(S, 1, P - 1);
  Result := StrToIntDef(Trim(S), 0);
end;

function CompareVer(const A, B: String): Integer;
var
  I, X, Y: Integer;
begin
  Result := 0;
  for I := 0 to 2 do
  begin
    X := VerPart(A, I);
    Y := VerPart(B, I);
    if X < Y then
    begin
      Result := -1;
      Exit;
    end;
    if X > Y then
    begin
      Result := 1;
      Exit;
    end;
  end;
end;

function ShortVer(const V: String): String;
begin
  Result := IntToStr(VerPart(V, 0)) + '.' + IntToStr(VerPart(V, 1)) + '.' + IntToStr(VerPart(V, 2));
end;

// Versión ya instalada: primero la clave de desinstalación; si falta, la versión del propio GuiaMHW.exe.
function GetInstalledVersion(): String;
var
  Key, ExePath, V: String;
begin
  Result := '';
  Key := 'Software\Microsoft\Windows\CurrentVersion\Uninstall\{6F0B3C52-7A1D-4E55-9C0E-2B8D4A1F7E31}_is1';
  if RegQueryStringValue(HKCU, Key, 'DisplayVersion', Result) then
    Exit;
  if RegQueryStringValue(HKLM, Key, 'DisplayVersion', Result) then
    Exit;
  Result := '';
  ExePath := ExpandConstant('{autopf}\GuiaMHW\GuiaMHW.exe');
  if FileExists(ExePath) then
    if GetVersionNumbersString(ExePath, V) then
      Result := V;
end;

// Texto con las novedades posteriores a la versión instalada (hasta la que se va a instalar).
function BuildNews(const Prev: String): String;
var
  Lines: TArrayOfString;
  I: Integer;
  L, Cur, Res: String;
  Show: Boolean;
begin
  Result := '';
  Res := '';
  Show := False;
  if not LoadStringsFromFile(ExpandConstant('{tmp}\CHANGELOG.txt'), Lines) then
    Exit;
  for I := 0 to GetArrayLength(Lines) - 1 do
  begin
    L := Trim(Lines[I]);
    if (L = '') or (Copy(L, 1, 1) = '#') and (Copy(L, 1, 3) <> '## ') then
      Continue;
    if Copy(L, 1, 3) = '## ' then
    begin
      Cur := Trim(Copy(L, 4, Length(L)));
      Show := (CompareVer(Cur, Prev) > 0) and (CompareVer(Cur, '{#AppVersion}') <= 0);
      if Show then
      begin
        if Res <> '' then
          Res := Res + #13#10;
        Res := Res + 'Versión ' + Cur + #13#10;
      end;
    end
    else if Show then
    begin
      if Copy(L, 1, 2) = '- ' then
        L := Copy(L, 3, Length(L));
      Res := Res + '   - ' + L + #13#10;
    end;
  end;
  Result := Trim(Res);
end;

procedure InitializeWizard();
var
  Prev: String;
begin
  NewsText := '';
  Prev := GetInstalledVersion();
  if (Prev <> '') and (CompareVer(Prev, '{#AppVersion}') < 0) then
  begin
    ExtractTemporaryFile('CHANGELOG.txt');
    NewsText := BuildNews(Prev);
    if NewsText <> '' then
      NewsPage := CreateOutputMsgMemoPage(wpWelcome, 'Novedades de esta actualización',
        'Qué cambia respecto a tu versión instalada',
        'Vas a actualizar Guía MHW de la versión ' + ShortVer(Prev) + ' a la {#AppVersion}. Estas son las mejoras y correcciones:',
        NewsText);
  end;
end;

// Al desinstalar se conservan tus datos (progreso, composiciones, copias) salvo que lo pidas.
// En una desinstalación silenciosa los datos NUNCA se borran.
procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var
  DataDir: String;
begin
  if CurUninstallStep = usPostUninstall then
  begin
    DataDir := ExpandConstant('{localappdata}\GuiaMHW');
    if DirExists(DataDir) and not UninstallSilent then
    begin
      if MsgBox('¿Quieres borrar también tus datos de Guía MHW (progreso, composiciones guardadas y copias de seguridad)?'#13#10#13#10 +
                DataDir + #13#10#13#10'Tu partida de Monster Hunter: World no se toca en ningún caso.',
                mbConfirmation, MB_YESNO or MB_DEFBUTTON2) = IDYES then
        DelTree(DataDir, True, True, True);
    end;
  end;
end;
