/**
 * Envia o PDF gerado para o OneDrive via Microsoft Graph.
 * Le ./saida/destino.json (criado por gerar-pdf.js) e faz o upload
 * criando as subpastas de Dia/Mes quando necessario.
 *
 * Segredos necessarios no repositorio (Settings > Secrets > Actions):
 *   MS_TENANT_ID, MS_CLIENT_ID, MS_CLIENT_SECRET, MS_REFRESH_TOKEN
 */
const fs = require('fs');
const path = require('path');

const SAIDA = path.join(__dirname, 'saida');
const { arquivo, pasta } = JSON.parse(fs.readFileSync(path.join(SAIDA, 'destino.json'), 'utf8'));
const G = 'https://graph.microsoft.com/v1.0';

async function token() {
  const body = new URLSearchParams({
    client_id: process.env.MS_CLIENT_ID,
    client_secret: process.env.MS_CLIENT_SECRET,
    grant_type: 'refresh_token',
    refresh_token: process.env.MS_REFRESH_TOKEN,
    scope: 'https://graph.microsoft.com/Files.ReadWrite offline_access'
  });
  const r = await fetch(`https://login.microsoftonline.com/${process.env.MS_TENANT_ID}/oauth2/v2.0/token`,
    { method: 'POST', body });
  const j = await r.json();
  if (!j.access_token) throw new Error('Falha na autenticacao: ' + JSON.stringify(j));
  return j.access_token;
}

async function garantirPastas(tk, caminho) {
  let atual = '';
  for (const parte of caminho.split('/')) {
    const pai = atual ? `${G}/me/drive/root:/${encodeURI(atual)}:/children` : `${G}/me/drive/root/children`;
    const r = await fetch(pai, {
      method: 'POST',
      headers: { Authorization: `Bearer ${tk}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: parte, folder: {}, '@microsoft.graph.conflictBehavior': 'fail' })
    });
    if (!r.ok && r.status !== 409) {
      const t = await r.text();
      if (!/nameAlreadyExists/i.test(t)) throw new Error(`Erro ao criar pasta "${parte}": ${t}`);
    }
    atual = atual ? `${atual}/${parte}` : parte;
  }
}

(async () => {
  const tk = await token();
  await garantirPastas(tk, pasta);
  const conteudo = fs.readFileSync(path.join(SAIDA, arquivo));
  const url = `${G}/me/drive/root:/${encodeURI(pasta + '/' + arquivo)}:/content`;
  const r = await fetch(url, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${tk}`, 'Content-Type': 'application/pdf' },
    body: conteudo
  });
  if (!r.ok) throw new Error('Erro no upload: ' + (await r.text()));
  const j = await r.json();
  console.log(`Enviado para OneDrive: ${pasta}/${arquivo}`);
  console.log(j.webUrl || '');
})().catch(e => { console.error('FALHOU:', e.message); process.exit(1); });
