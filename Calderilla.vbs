' Abre Calderilla sin la ventana negra. Para cerrarla: Ajustes -> Cerrar Calderilla.
' Antes de abrirla busca si hay una version nueva en GitHub y la instala (si Git esta instalado y hay
' conexion; si no, se abre igual). La primera vez, o tras actualizar, se ve la ventana mientras instala.
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
carpeta = fso.GetParentFolderName(WScript.ScriptFullName)
shell.CurrentDirectory = carpeta

' Ejecuta una orden sin ventana y devuelve su codigo de salida
Function Ejecutar(orden)
  Ejecutar = shell.Run("cmd /c " & orden, 0, True)
End Function

If Ejecutar("where git") = 0 Then
  If Not fso.FolderExists(carpeta & "\.git") Then
    Ejecutar "git init -q -b main && git remote add origin https://github.com/ByIDante/calderilla.git"
  End If
  If Ejecutar("git fetch -q origin main") = 0 Then
    ' Solo si GitHub tiene algo distinto de lo instalado
    If Ejecutar("git diff --quiet HEAD origin/main") <> 0 Then Ejecutar "git reset -q --hard origin/main"
  End If
End If

shell.Environment("PROCESS")("CALDERILLA_OCULTO") = "1"
visible = 0
If Not fso.FolderExists(carpeta & "\node_modules") Then
  visible = 1
ElseIf Ejecutar("node scripts\comprobar-dependencias.ts") <> 0 Then
  visible = 1
End If
shell.Run "cmd /c Calderilla.cmd", visible, False
