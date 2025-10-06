// index.js - Enhanced print job queue
const express = require('express');
const bodyParser = require('body-parser');
const { v4: uuidv4 } = require('uuid');

const app = express();

// Enhanced CORS configuration
app.use((req, res, next) => {
  const allowedOrigins = [
    'http://localhost:4200',
    'https://app-print-sinlibreria.vercel.app'
  ];
  const origin = req.headers.origin;
  
  if (allowedOrigins.includes(origin)) {
    res.header('Access-Control-Allow-Origin', origin);
  }
  
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, X-API-Key, X-Pairing-Token, Authorization');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  next();
});

app.use(bodyParser.json({ limit: '10mb' }));

const API_KEY = process.env.API_KEY || 'secret-api-key';
const AGENT_TOKEN = process.env.AGENT_TOKEN || 'mi-token-seguro-que-pegaras-en-panel';

// Enhanced jobs store with TTL
const jobs = new Map();
const JOB_TTL = 30 * 60 * 1000; // 30 minutes

// Cleanup old jobs
setInterval(() => {
  const now = Date.now();
  for (const [id, job] of jobs.entries()) {
    const jobTime = new Date(job.createdAt).getTime();
    if (now - jobTime > JOB_TTL) {
      jobs.delete(id);
    }
  }
}, 60 * 1000);

// Enhanced API key middleware
function requireApiKey(req, res, next) {
  const k = req.headers['x-api-key'] || req.query.apiKey;
  if (k !== API_KEY) return res.status(401).json({ success: false, message: 'Unauthorized - invalid API key' });
  next();
}

// Enhanced job creation with advanced print options
app.post('/api/print/jobs', requireApiKey, (req, res) => {
  const { 
    agentId, 
    printerName, 
    type = 'text', 
    payload, 
    encoding = 'utf8', 
    cutType = 'full', 
    feedLines = 3,
    // Advanced options
    pageWidth = 80,
    pageHeight = 297,
    marginLeft = 0,
    marginTop = 0,
    fontSize = 12,
    fontName = 'Courier New',
    bold = false,
    align = 'left',
    characterSet = 'UTF-8',
    // Thermal printer specific
    density = 8,
    speed = 3,
    invert = false,
    // Barcode/QR options
    barcode = null,
    qrCode = null
  } = req.body || {};
  
  if (!printerName || !payload) {
    return res.status(400).json({ success: false, message: 'printerName and payload required' });
  }
  
  const id = uuidv4();
  const job = { 
    id, 
    agentId: agentId || null, 
    printerName, 
    type, 
    payload, 
    encoding, 
    cutType, 
    feedLines,
    // Advanced settings
    pageWidth: parseInt(pageWidth),
    pageHeight: parseInt(pageHeight),
    marginLeft: parseInt(marginLeft),
    marginTop: parseInt(marginTop),
    fontSize: parseInt(fontSize),
    fontName,
    bold: Boolean(bold),
    align,
    characterSet,
    // Thermal settings
    density: parseInt(density),
    speed: parseInt(speed),
    invert: Boolean(invert),
    // Graphics
    barcode,
    qrCode,
    // Status
    status: 'pending', 
    result: null, 
    createdAt: new Date().toISOString(),
    clientInfo: req.headers['user-agent'] || 'unknown'
  };
  
  jobs.set(id, job);
  console.log(`Job created: ${id} for printer: ${printerName}`);
  return res.json({ success: true, jobId: id, job });
});

// Enhanced pending jobs endpoint
app.get('/api/print/jobs/pending', (req, res) => {
  const token = req.headers['x-pairing-token'];
  if (token !== AGENT_TOKEN) return res.status(401).json({ success: false, message: 'Unauthorized agent' });

  const agentId = req.query.agentId || null;
  const limit = parseInt(req.query.limit) || 10;
  const pending = [];
  
  for (const job of jobs.values()) {
    if (job.status === 'pending' && (!job.agentId || job.agentId === agentId)) {
      pending.push(job);
      if (pending.length >= limit) break;
    }
  }
  
  return res.json({ success: true, jobs: pending });
});

// Enhanced job status update
app.post('/api/print/jobs/:id/ack', (req, res) => {
  const token = req.headers['x-pairing-token'];
  if (token !== AGENT_TOKEN) return res.status(401).json({ success: false, message: 'Unauthorized agent' });

  const id = req.params.id;
  const job = jobs.get(id);
  if (!job) return res.status(404).json({ success: false, message: 'job not found' });

  const { status, result, errorDetail } = req.body || {};
  if (status) job.status = status;
  if (result) job.result = result;
  if (errorDetail) job.errorDetail = errorDetail;
  job.updatedAt = new Date().toISOString();
  
  jobs.set(id, job);
  return res.json({ success: true });
});

// Get job status
app.get('/api/print/jobs/:id', (req, res) => {
  const id = req.params.id;
  const job = jobs.get(id);
  if (!job) return res.status(404).json({ success: false, message: 'job not found' });
  return res.json({ success: true, job });
});

// Health check with stats
app.get('/healthz', (req, res) => {
  const stats = {
    totalJobs: jobs.size,
    pendingJobs: Array.from(jobs.values()).filter(j => j.status === 'pending').length,
    processingJobs: Array.from(jobs.values()).filter(j => j.status === 'processing').length,
    completedJobs: Array.from(jobs.values()).filter(j => j.status === 'done').length,
    errorJobs: Array.from(jobs.values()).filter(j => j.status === 'error').length
  };
  
  res.json({ 
    status: 'ok', 
    time: new Date().toISOString(),
    stats 
  });
});

const PORT = process.env.PORT || 3000;
console.log('Enhanced Print Server listening on port', PORT);
app.listen(PORT);