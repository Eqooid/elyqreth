// Same network namespace only. No health token, database credential or public readiness endpoint.
const port=process.env.API_PORT??'3001';
if(!/^[0-9]{1,5}$/.test(port)||Number(port)<1||Number(port)>65535)process.exit(1);
fetch(`http://127.0.0.1:${port}/ready`,{signal:AbortSignal.timeout(2000),redirect:'error'}).then(async r=>{const body=await r.json();process.exit(r.status===200&&body.status==='ready'?0:1);}).catch(()=>process.exit(1));
