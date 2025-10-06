// index.js
require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const tmp = require('tmp');
const fs = require('fs');
const { spawn } = require('child_process');
const os = require('os');
const path = require('path');

const app = express();
app.use(bodyParser.json({ limit: '10mb' }));

const PAIRING_TOKEN = process.env.PAIRING_TOKEN || 'changeme-token'; // cambia en producción
const PORT = process.env.PORT || 5000;

// Try to require optional native printer module (may fail)
let nativePrinter = null;
try {
  nativePrinter = require('printer'); // optional, uncomment dependency if installed
} catch (e) {
  nativePrinter = null;
  console.log('Aviso: módulo "printer" no disponible. Windows fallback no nativo activado.');
}

function unauthorized(res){
  return res.status(401).json({ success:false, message: 'Unauthorized' });
}

function validateToken(req) {
  const header = req.headers['x-pairing-token'];
  if (!PAIRING_TOKEN) return false;
  return header === PAIRING_TOKEN;
}

function hexToBuffer(hex) {
  hex = hex.replace(/\s|-/g,'');
  if (hex.length % 2 !== 0) throw new Error('Hex length must be even');
  return Buffer.from(hex, 'hex');
}

async function runCommand(cmd, args, timeout = 10000) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args);
    let out = '', err = '';
    p.stdout.on('data', d => out += d.toString());
    p.stderr.on('data', d => err += d.toString());
    const killTimer = setTimeout(() => {
      try { p.kill(); } catch {}
      reject(new Error('Timeout'));
    }, timeout);
    p.on('close', code => {
      clearTimeout(killTimer);
      resolve({ code, out, err });
    });
    p.on('error', e => reject(e));
  });
}

// GET /printers
app.get('/printers', async (req, res) => {
  if (!validateToken(req)) return unauthorized(res);

  try {
    if (os.platform() === 'win32') {
      // If native printer module is available -> use it
      if (nativePrinter && typeof nativePrinter.getPrinters === 'function') {
        const list = nativePrinter.getPrinters().map(p => ({ name: p.name, options: p }));
        return res.json({ success: true, message: 'Impresoras (native)', data: list });
      }

      // Fallback: use PowerShell Get-Printer (Windows 8+/Server)
      try {
        const ps = await runCommand('powershell', ['-NoProfile', '-Command', 'Get-Printer | Select-Object -Property Name,ShareName,ComputerName | ConvertTo-Json']);
        if (ps.code === 0 && ps.out) {
          const data = JSON.parse(ps.out);
          const list = Array.isArray(data) ? data.map(p => ({ name: p.Name })) : [{ name: data.Name }];
          return res.json({ success: true, message: 'Impresoras (powershell)', data: list });
        }
      } catch (e) {
        // continue to error response
      }

      return res.json({ success: false, message: 'No se pudo obtener impresoras en Windows. Instala el módulo nativo "printer" o usa la versión .NET.' });
    } else {
      // Linux/macOS - try lpstat
      try {
        const which = await runCommand('which', ['lpstat']);
        if (which.code !== 0) {
          return res.json({ success: false, message: "'lpstat' no está disponible en este host. Instala CUPS o usa el agente Windows/.NET en la tienda." });
        }
        const { out } = await runCommand('lpstat', ['-p']);
        const lines = out.split(/\r?\n/).filter(Boolean);
        const printers = lines.map(l => {
          // "printer NAME is ... "
          const m = l.match(/^printer\s+([^\s]+)/i);
          return m ? { name: m[1], raw: l } : { raw: l };
        });
        return res.json({ success: true, message: 'Impresoras (lpstat -p)', data: printers });
      } catch (e) {
        return res.json({ success: false, message: 'Error ejecutando lpstat: ' + (e.message || e) });
      }
    }
  } catch (err) {
    return res.json({ success: false, message: err.message || String(err) });
  }
});

// POST /print
// body: { printerName, type: 'text'|'base64'|'hex', payload, encoding, cutType, feedLines }
app.post('/print', async (req, res) => {
  if (!validateToken(req)) return unauthorized(res);

  const { printerName, type = 'text', payload = '', encoding = 'utf8', cutType = 'full', feedLines = 3 } = req.body || {};

  if (!printerName) return res.status(400).json({ success: false, message: 'printerName required' });

  try {
    let buffer;
    if (type === 'base64') {
      buffer = Buffer.from(payload, 'base64');
    } else if (type === 'hex') {
      buffer = hexToBuffer(payload);
    } else {
      buffer = Buffer.from(String(payload || ''), encoding || 'utf8');
    }

    // Append feed lines and ESC/POS cut commands if requested
    const footer = [];
    for (let i=0;i<feedLines;i++) footer.push(0x0A);
    // ESC d n (feed n lines) then cut
    footer.push(0x1B, 0x64, 0x02);
    if (cutType === 'partial') {
      footer.push(0x1B, 0x6D);
    } else {
      footer.push(0x1D, 0x56, 0x00);
    }
    const outBuffer = Buffer.concat([buffer, Buffer.from(footer)]);

    if (os.platform() === 'win32') {
      // Try native printer module if present
      if (nativePrinter && typeof nativePrinter.printDirect === 'function') {
        // printDirect expects data Buffer and options
        await new Promise((resolve, reject) => {
          nativePrinter.printDirect({
            data: outBuffer,
            printer: printerName,
            type: 'RAW',
            success: jobID => resolve(jobID),
            error: err => reject(err)
          });
        });
        return res.json({ success: true, message: 'Enviado a impresora (native module).' });
      }

      // Fallback: write temp file and use PowerShell to print via Out-Printer (text only)
      if (type === 'text') {
        const tmpFile = tmp.fileSync({ postfix: '.txt' });
        fs.writeFileSync(tmpFile.name, outBuffer, { encoding: 'utf8' });
        // Use Out-Printer in PowerShell to send text to printer
        const cmd = `Get-Content -Path "${tmpFile.name}" -Raw | Out-Printer -Name "${printerName}"`;
        const ps = await runCommand('powershell', ['-NoProfile', '-Command', cmd], 15000);
        tmpFile.removeCallback();
        if (ps.code === 0) return res.json({ success: true, message: 'Impresión enviada vía PowerShell (texto).' });
        return res.status(500).json({ success: false, message: 'PowerShell error', detail: ps.err || ps.out });
      } else {
        return res.status(400).json({ success: false, message: 'Impresión de raw bytes en Windows requiere el módulo nativo "printer". Recomendado: instalar módulo o usar agente .NET.' });
      }
    } else {
      // Linux/macOS - use lp (CUPS)
      // create a temp file
      const tmpFile = tmp.fileSync();
      fs.writeFileSync(tmpFile.name, outBuffer);

      // '-o raw' to send raw bytes; -d printerName to choose printer
      const args = ['-d', printerName, '-o', 'raw', tmpFile.name];
      const { code, out, err } = await runCommand('lp', args, 10000).catch(e => ({ code: -1, out: '', err: e.message }));
      tmpFile.removeCallback();
      if (code === 0) return res.json({ success: true, message: 'Enviado a CUPS (lp -o raw).' });
      // try lpr fallback
      const lpr = await runCommand('lpr', ['-P', printerName, tmpFile.name]).catch(e => ({ code: -1, out: '', err: e.message }));
      if (lpr.code === 0) return res.json({ success: true, message: 'Enviado a CUPS (lpr).' });
      return res.status(500).json({ success: false, message: 'Error enviando a impresora', detail: err || lpr.err || out });
    }
  } catch (e) {
    return res.status(500).json({ success: false, message: e.message || String(e) });
  }
});

app.get('/', (req, res) => res.json({ success: true, message: 'GaiaPrint Agent', env: { platform: os.platform() } }));

app.listen(PORT, () => console.log(`GaiaPrint Agent escuchando en ${PORT} - token: ${PAIRING_TOKEN}`));
