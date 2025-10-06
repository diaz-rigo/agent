// // index.js - simple job queue demo (memory). Deploy to Render.
// const express = require('express');
// const bodyParser = require('body-parser');
// const { v4: uuidv4 } = require('uuid');

// const app = express();

// // Middleware CORS
// app.use((req, res, next) => {
//   const allowedOrigins = [
//     'http://localhost:4200',
//     'https://app-print-sinlibreria.vercel.app' // reemplaza con tu dominio en producción
//   ];
//   const origin = req.headers.origin;
  
//   if (allowedOrigins.includes(origin)) {
//     res.header('Access-Control-Allow-Origin', origin);
//   }
//     res.header('Access-Control-Allow-Origin', '*');
//   res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
//   res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, X-API-Key, X-Pairing-Token, Authorization');
    
//   // res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
//   // res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, X-API-Key, X-Pairing-Token');
//   // res.header('Access-Control-Allow-Credentials', 'true');
  
//   // Manejar preflight requests
//   if (req.method === 'OPTIONS') {
//     return res.status(200).end();
//   }
  
//   next();
// });

// app.use(bodyParser.json());

// const API_KEY = process.env.API_KEY || 'secret-api-key';
// const AGENT_TOKEN = process.env.AGENT_TOKEN || 'mi-token-seguro-que-pegaras-en-panel';

// // Simple in-memory jobs store
// const jobs = new Map();

// // Middleware para proteger creación de jobs desde UI/backend
// function requireApiKey(req, res, next) {
//   const k = req.headers['x-api-key'] || req.query.apiKey;
//   if (k !== API_KEY) return res.status(401).json({ success: false, message: 'Unauthorized - invalid API key' });
//   next();
// }

// // Crear job (Angular o Admin crea job)
// app.post('/api/print/jobs', requireApiKey, (req, res) => {
//   const { agentId, printerName, type = 'text', payload, encoding = 'utf8', cutType = 'full', feedLines = 3 } = req.body || {};
//   if (!printerName || !payload) return res.status(400).json({ success: false, message: 'printerName and payload required' });
  
//   const id = uuidv4();
//   const job = { 
//     id, 
//     agentId: agentId || null, 
//     printerName, 
//     type, 
//     payload, 
//     encoding, 
//     cutType, 
//     feedLines, 
//     status: 'pending', 
//     result: null, 
//     createdAt: new Date().toISOString() 
//   };
  
//   jobs.set(id, job);
//   return res.json({ success: true, jobId: id });
// });

// // Agent pide jobs pendientes (poll)
// app.get('/api/print/jobs/pending', (req, res) => {
//   const token = req.headers['x-pairing-token'];
//   if (token !== AGENT_TOKEN) return res.status(401).json({ success: false, message: 'Unauthorized agent' });

//   const agentId = req.query.agentId || null;
//   const pending = [];
  
//   for (const job of jobs.values()) {
//     if (job.status === 'pending' && (!job.agentId || job.agentId === agentId)) {
//       pending.push(job);
//       if (pending.length >= 5) break;
//     }
//   }
  
//   return res.json({ success: true, jobs: pending });
// });

// // Agent ack result
// app.post('/api/print/jobs/:id/ack', (req, res) => {
//   const token = req.headers['x-pairing-token'];
//   if (token !== AGENT_TOKEN) return res.status(401).json({ success: false, message: 'Unauthorized agent' });

//   const id = req.params.id;
//   const job = jobs.get(id);
//   if (!job) return res.status(404).json({ success: false, message: 'job not found' });

//   const { status, result } = req.body || {};
//   if (status) job.status = status;
//   if (result) job.result = result;
//   job.updatedAt = new Date().toISOString();
  
//   jobs.set(id, job);
//   return res.json({ success: true });
// });

// // health
// app.get('/healthz', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

// const PORT = process.env.PORT || 3000;
// console.log('Server listening', PORT);
// app.listen(PORT);