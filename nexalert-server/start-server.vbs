Set ws = CreateObject("Wscript.Shell")
ws.CurrentDirectory = "C:\Users\STIVEN\Documents\Default Project\nexalert-server"
ws.Run "node src/index.js", 0, False
