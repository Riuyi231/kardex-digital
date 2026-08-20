const {DatabaseSync}=require('node:sqlite');
const db=new DatabaseSync('/opt/nexalert-server/data/nexalert-server.db',{readOnly:true});
const f=db.prepare('SELECT id,reporte_id,nombre,tipo,LENGTH(datos) as datosLen FROM fotos ORDER BY id DESC LIMIT 5').all();
console.log('FOTOS:',JSON.stringify(f));
const s=db.prepare("SELECT seq,tipo,ref_id,extra FROM seq_log WHERE tipo='foto' ORDER BY seq DESC LIMIT 5").all();
console.log('SEQ_FOTOS:',JSON.stringify(s));
const r=db.prepare('SELECT id,adjuntos,estado,updated_at FROM reportes ORDER BY id DESC LIMIT 5').all();
console.log('REPORTES:',JSON.stringify(r));
db.close();
