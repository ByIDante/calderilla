' Abre Calderilla sin la ventana negra. Para cerrarla: Ajustes -> Cerrar Calderilla.
' La primera vez (o tras actualizar) se ve la ventana mientras instala lo necesario.
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
carpeta = fso.GetParentFolderName(WScript.ScriptFullName)
shell.CurrentDirectory = carpeta
shell.Environment("PROCESS")("CALDERILLA_OCULTO") = "1"
visible = 0
If Not fso.FolderExists(carpeta & "\node_modules") Then
  visible = 1
ElseIf shell.Run("cmd /c node scripts\comprobar-dependencias.ts", 0, True) <> 0 Then
  visible = 1
End If
shell.Run "cmd /c Calderilla.cmd", visible, False
