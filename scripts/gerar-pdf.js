/**
 * Fluxo de Artes TNT 2.0 - gerador automatico de PDF direto do site.
 * Abre https://lucasbitto.github.io/FluxogramaArtes/ em um navegador
 * headless, dispara o mesmo botao "PDF do dia" / "PDF do mes" da pagina
 * e salva o resultado em ./saida com a data no nome do arquivo.
 *
 * Uso:  node gerar-pdf.js dia     -> Fluxo-Artes_DIA_AAAA-MM-DD.pdf
 *       node gerar-pdf.js mes     -> Fluxo-Artes_MES_AAAA-MM.pdf
 */
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

const SITE = process.env.SITE_URL || 'https://lucasbitto.github.io/FluxogramaArtes/';
const TZ = 'America/Sao_Paulo';
const MODO = (process.argv[2] || 'dia').toLowerCase();
const SAIDA = path.join(__dirname, 'saida');

function hojeBR() {
  // AAAA-MM-DD no fuso de Sao Paulo, independente do fuso do runner
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date());
}
function mesAnterior() {
  const [a, m] = hojeBR().split('-').map(Number);
  const d = new Date(Date.UTC(a, m - 1, 1));
  d.setUTCMonth(d.getUTCMonth() - 1);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

(async () => {
  const dia = hojeBR();
  const mes = MODO === 'mes' ? mesAnterior() : dia.slice(0, 7);
  const nome = MODO === 'mes'
    ? `Fluxo-Artes_MES_${mes}.pdf`
    : `Fluxo-Artes_DIA_${dia}.pdf`;

  fs.mkdirSync(SAIDA, { recursive: true });

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--font-render-hinting=none']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 1200, deviceScaleFactor: 2 });
  // O site chama window.print(); neutralizamos para capturar o PDF nos.
  await page.evaluateOnNewDocument(() => { window.print = () => { window.__printOk = true; }; });
  await page.emulateTimezone(TZ);

  console.log('Abrindo', SITE);
  await page.goto(SITE, { waitUntil: 'networkidle2', timeout: 120000 });

  // Espera a sincronizacao com a planilha terminar
  await page.waitForFunction(
    () => {
      const s = document.getElementById('sync');
      return s && /sincronizado/i.test(s.textContent || '');
    },
    { timeout: 120000 }
  ).catch(() => console.warn('Aviso: status de sincronizacao nao confirmado, seguindo mesmo assim.'));
  await new Promise(r => setTimeout(r, 4000));

  // Abre a aba de relatorios (o PDF e montado a partir dela)
  await page.evaluate(() => {
    const alvo = [...document.querySelectorAll('.chip,.btn,[data-view],[onclick]')]
      .find(b => /relat/i.test(b.textContent || ''));
    if (alvo) alvo.click();
  });
  await new Promise(r => setTimeout(r, 1500));

  const ok = await page.evaluate((modo, dia, mes) => {
    const sel = document.getElementById('month');
    if (sel) {
      const alvo = modo === 'mes' ? mes : dia.slice(0, 7);
      if ([...sel.options].some(o => o.value === alvo || o.text === alvo)) {
        sel.value = alvo;
        sel.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }
    const inp = document.getElementById('date');
    if (inp && modo === 'dia') {
      inp.value = dia;
      inp.dispatchEvent(new Event('change', { bubbles: true }));
    }
    if (typeof window.renderReports === 'function') window.renderReports();
    if (modo === 'mes') {
      const b = document.getElementById('printMonth');
      if (!b) return 'botao do mes nao encontrado';
      b.click();
    } else if (typeof window.printDailyReport === 'function') {
      window.printDailyReport(dia);
    } else {
      const b = document.getElementById('printDay');
      if (!b) return 'botao do dia nao encontrado';
      b.click();
    }
    return 'ok';
  }, MODO, dia, mes);

  if (ok !== 'ok') throw new Error('Nao foi possivel disparar a geracao: ' + ok);

  // Da tempo para o layout de impressao ser montado
  await new Promise(r => setTimeout(r, 6000));

  const temConteudo = await page.evaluate(() =>
    document.body.classList.contains('print-day') || document.body.classList.contains('print-month'));
  if (!temConteudo) throw new Error('O site nao entrou em modo de impressao (provavelmente nao ha dados no periodo).');

  const destino = path.join(SAIDA, nome);
  await page.pdf({
    path: destino,
    format: 'A4',
    printBackground: true,
    preferCSSPageSize: true,
    margin: { top: '10mm', bottom: '10mm', left: '8mm', right: '8mm' }
  });
  await browser.close();

  const kb = Math.round(fs.statSync(destino).size / 1024);
  console.log(`PDF gerado: ${nome} (${kb} KB)`);
  // Informacoes para o passo de upload
  const pasta = MODO === 'mes'
    ? `Fluxo de Artes TNT - Relatorios/Mensal/${mes.slice(0, 4)}`
    : `Fluxo de Artes TNT - Relatorios/Diario/${dia.slice(0, 7)}`;
  fs.writeFileSync(path.join(SAIDA, 'destino.json'), JSON.stringify({ arquivo: nome, pasta }, null, 2));
})().catch(e => { console.error('FALHOU:', e.message); process.exit(1); });
