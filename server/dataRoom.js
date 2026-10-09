const path = require('node:path');
const fs = require('node:fs/promises');
const { spawn } = require('node:child_process');

// Opening Explorer belongs to the local desktop, never a remote/proxied CRM.
function isLocalDesktopRequest(req) {
  const loopback = ['127.0.0.1', '::1', '::ffff:127.0.0.1'];
  const host = req.headers.host || '';
  return loopback.includes(req.socket.remoteAddress)
    && /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(host)
    && !req.headers['x-forwarded-for'] && !req.headers.forwarded;
}

function dataRoomFolderPath(value) {
  let folder = typeof value === 'string' ? value.trim() : '';
  // Windows "Copy as path" includes quotes; they aren't part of the path.
  if (folder.startsWith('"') && folder.endsWith('"')) folder = folder.slice(1, -1).trim();
  if (!/^[a-z]:[\\/]/i.test(folder) && !/^\\\\[^\\/]+[\\/][^\\/]+/.test(folder)) return '';
  folder = path.win32.normalize(folder);
  // Reject device namespaces, controls, and embedded quotes. Never run a shell.
  if (/^\\\\[?.]\\/.test(folder) || /[\x00-\x1f"]/.test(folder)) return '';
  return folder;
}

async function openDataRoomFolder(value, { stat = fs.stat, launch = spawn, platform = process.platform } = {}) {
  if (platform !== 'win32') throw new Error('Локальную папку можно открыть только в CRM, запущенной на вашем Windows-компьютере. Для удалённой CRM укажите веб-ссылку на дата-рум.');
  const folder = dataRoomFolderPath(value);
  if (!folder) throw new Error('Укажите полный путь к папке, например C:\\DataRoom\\Клиент, и сохраните его.');
  let timer;
  try {
    const info = await Promise.race([
      stat(folder),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Папка не отвечает. Проверьте подключение к диску или Nextcloud.')), 4000); }),
    ]);
    if (!info.isDirectory()) throw new Error('Сохранённый путь ведёт к файлу. Укажите папку дата-рума.');
  } catch (err) {
    if (err.code === 'ENOENT' || err.code === 'ENOTDIR') throw new Error('Папка не найдена. Проверьте сохранённый путь к дата-руму.');
    if (err.code === 'EACCES' || err.code === 'EPERM') throw new Error('Нет доступа к папке дата-рума.');
    throw err;
  } finally { clearTimeout(timer); }
  await new Promise((resolve, reject) => {
    const child = launch(path.win32.join(process.env.SystemRoot || 'C:\\Windows', 'explorer.exe'), [folder], {
      shell: false, detached: true, stdio: 'ignore', windowsHide: false,
    });
    child.once('error', () => reject(new Error('Не удалось запустить Проводник.')));
    child.once('spawn', () => { child.unref(); resolve(); });
  });
}

module.exports = { isLocalDesktopRequest, dataRoomFolderPath, openDataRoomFolder };
