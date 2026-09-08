const COT_CONFIG = {
  spreadsheetId: '1Y9CX9Sfv0EG0474VQnRnAdN1O27z8RVYqMOPqdLg3FI',
  repoOwner: 'luanacaroliny-cyber',
  repoName: 'order_cot',
  branch: 'main',
  partSize: 24000,
  dataDir: 'public/data-parts',
  sheets: [
    { name: 'bd_cot', key: 'bd', source: 'bd' },
    { name: 'backlog', key: 'backlog', source: 'backlog' },
  ],
};

/**
 * Função principal. Lê a planilha privada, compacta os dados e publica
 * os data-parts no GitHub em um único commit.
 */
function sincronizarCOT() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) {
    console.log('Sincronização já está em execução.');
    return;
  }

  try {
    const token = PropertiesService.getScriptProperties().getProperty('GITHUB_TOKEN');
    if (!token) {
      throw new Error('GITHUB_TOKEN não configurado em Propriedades do script.');
    }

    const ss = SpreadsheetApp.openById(COT_CONFIG.spreadsheetId);
    const payload = {
      updatedAt: new Date().toISOString(),
      bd: [],
      backlog: [],
    };

    COT_CONFIG.sheets.forEach((config) => {
      const sheet = ss.getSheetByName(config.name);
      if (!sheet) throw new Error(`Aba não encontrada: ${config.name}`);
      payload[config.key] = normalizarAba_(sheet, config.source);
    });

    // Evita commits desnecessários quando nenhuma linha mudou.
    const dataForHash = JSON.stringify({ bd: payload.bd, backlog: payload.backlog });
    const dataHash = sha256Hex_(dataForHash);
    const props = PropertiesService.getScriptProperties();
    const previousHash = props.getProperty('LAST_DATA_HASH');

    if (previousHash === dataHash) {
      console.log(JSON.stringify({
        status: 'sem_alteracoes',
        bd: payload.bd.length,
        backlog: payload.backlog.length,
      }));
      return;
    }

    const json = JSON.stringify(payload);
    const gzipBlob = Utilities.gzip(
      Utilities.newBlob(json, 'application/json', 'cot-data.json'),
      'cot-data.json.gz',
    );
    const compressedBytes = gzipBlob.getBytes();

    const parts = [];
    for (let offset = 0; offset < compressedBytes.length; offset += COT_CONFIG.partSize) {
      parts.push(compressedBytes.slice(offset, offset + COT_CONFIG.partSize));
    }

    const result = publicarNoGitHub_(token, parts, payload.updatedAt, {
      bd: payload.bd.length,
      backlog: payload.backlog.length,
    });

    props.setProperty('LAST_DATA_HASH', dataHash);
    props.setProperty('LAST_SYNC_AT', payload.updatedAt);
    props.setProperty('LAST_COMMIT_SHA', result.commitSha);

    console.log(JSON.stringify({
      status: 'sincronizado',
      updatedAt: payload.updatedAt,
      bd: payload.bd.length,
      backlog: payload.backlog.length,
      compressedBytes: compressedBytes.length,
      parts: parts.length,
      commitSha: result.commitSha,
    }));
  } finally {
    lock.releaseLock();
  }
}

/**
 * Teste sem escrever no GitHub. Use primeiro para validar acesso à planilha.
 */
function testarLeituraCOT() {
  const ss = SpreadsheetApp.openById(COT_CONFIG.spreadsheetId);
  const result = {};

  COT_CONFIG.sheets.forEach((config) => {
    const sheet = ss.getSheetByName(config.name);
    if (!sheet) throw new Error(`Aba não encontrada: ${config.name}`);
    const rows = normalizarAba_(sheet, config.source);
    result[config.name] = {
      registros: rows.length,
      primeiraLinha: rows[0] || null,
    };
  });

  console.log(JSON.stringify(result, null, 2));
}

/**
 * Cria o agendamento automático de 5 em 5 minutos.
 * Pode rodar novamente sem duplicar o trigger.
 */
function criarTrigger5Min() {
  ScriptApp.getProjectTriggers()
    .filter((trigger) => trigger.getHandlerFunction() === 'sincronizarCOT')
    .forEach((trigger) => ScriptApp.deleteTrigger(trigger));

  ScriptApp.newTrigger('sincronizarCOT')
    .timeBased()
    .everyMinutes(5)
    .create();

  console.log('Trigger criado: sincronizarCOT a cada 5 minutos.');
}

function normalizarAba_(sheet, source) {
  const lastRow = sheet.getLastRow();
  const lastColumn = Math.min(sheet.getLastColumn(), 13);
  if (lastRow < 2 || lastColumn < 1) return [];

  // getDisplayValues preserva o formato yyyy-mm-dd usado em cut_off_date.
  const rows = sheet.getRange(1, 1, lastRow, lastColumn).getDisplayValues();
  const headers = rows[0].map((value) => String(value).trim());
  const column = {};
  headers.forEach((name, index) => { column[name] = index; });

  const required = [
    'wms_order_no',
    'parcel_id',
    'lm_tracking_number',
    'whs_id',
    'cut_off_date',
    'cut_off_datetime',
    'status_code',
    'status_label',
    'urgent_flag',
    'oos_flag',
    'channel_name',
    'order_total_item_qty',
    'latest_update_datetime',
  ];

  const missing = required.filter((name) => column[name] === undefined);
  if (missing.length) {
    throw new Error(`Colunas ausentes em ${sheet.getName()}: ${missing.join(', ')}`);
  }

  const get = (row, name) => String(row[column[name]] ?? '').trim();
  const output = [];

  for (let i = 1; i < rows.length; i += 1) {
    const row = rows[i];
    const order = get(row, 'wms_order_no');
    if (!order) continue;

    output.push({
      src: source,
      o: order,
      p: get(row, 'parcel_id'),
      t: get(row, 'lm_tracking_number'),
      w: get(row, 'whs_id'),
      d: get(row, 'cut_off_date').slice(0, 10),
      dt: get(row, 'cut_off_datetime'),
      sc: get(row, 'status_code'),
      s: get(row, 'status_label') || 'Sem status',
      u: asBoolean_(get(row, 'urgent_flag')),
      x: asBoolean_(get(row, 'oos_flag')),
      ch: get(row, 'channel_name'),
      q: asInteger_(get(row, 'order_total_item_qty')),
      l: get(row, 'latest_update_datetime'),
    });
  }

  return output;
}

function asBoolean_(value) {
  return !['', '0', '0.0', 'false', 'não', 'nao', 'none'].includes(
    String(value ?? '').trim().toLowerCase(),
  );
}

function asInteger_(value) {
  const parsed = Number(String(value ?? '0').replace(',', '.'));
  return Number.isFinite(parsed) ? Math.trunc(parsed) : 0;
}

function sha256Hex_(text) {
  const bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    text,
    Utilities.Charset.UTF_8,
  );
  return bytes.map((byte) => ((byte + 256) % 256).toString(16).padStart(2, '0')).join('');
}

function publicarNoGitHub_(token, parts, updatedAt, counts) {
  const base = `/repos/${COT_CONFIG.repoOwner}/${COT_CONFIG.repoName}`;

  const ref = githubApi_(token, 'get', `${base}/git/ref/heads/${COT_CONFIG.branch}`);
  const headSha = ref.object.sha;

  const headCommit = githubApi_(token, 'get', `${base}/git/commits/${headSha}`);
  const baseTreeSha = headCommit.tree.sha;

  const treeEntries = [];

  parts.forEach((bytes, index) => {
    const blob = githubApi_(token, 'post', `${base}/git/blobs`, {
      content: Utilities.base64Encode(bytes),
      encoding: 'base64',
    });

    treeEntries.push({
      path: `${COT_CONFIG.dataDir}/part-${String(index).padStart(3, '0')}`,
      mode: '100644',
      type: 'blob',
      sha: blob.sha,
    });
  });

  const manifestText = JSON.stringify({
    parts: parts.length,
    updatedAt,
    bd: counts.bd,
    backlog: counts.backlog,
  }) + '\n';

  const manifestBlob = githubApi_(token, 'post', `${base}/git/blobs`, {
    content: manifestText,
    encoding: 'utf-8',
  });

  treeEntries.push({
    path: `${COT_CONFIG.dataDir}/manifest.json`,
    mode: '100644',
    type: 'blob',
    sha: manifestBlob.sha,
  });

  const newTree = githubApi_(token, 'post', `${base}/git/trees`, {
    base_tree: baseTreeSha,
    tree: treeEntries,
  });

  const newCommit = githubApi_(token, 'post', `${base}/git/commits`, {
    message: `Atualiza dados COT ${updatedAt}`,
    tree: newTree.sha,
    parents: [headSha],
  });

  githubApi_(token, 'patch', `${base}/git/refs/heads/${COT_CONFIG.branch}`, {
    sha: newCommit.sha,
    force: false,
  });

  return { commitSha: newCommit.sha };
}

function githubApi_(token, method, path, body) {
  const options = {
    method,
    muteHttpExceptions: true,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2026-03-10',
    },
  };

  if (body !== undefined) {
    options.contentType = 'application/json';
    options.payload = JSON.stringify(body);
  }

  const response = UrlFetchApp.fetch(`https://api.github.com${path}`, options);
  const status = response.getResponseCode();
  const text = response.getContentText();

  if (status < 200 || status >= 300) {
    throw new Error(`GitHub API ${status}: ${text}`);
  }

  return text ? JSON.parse(text) : {};
}
