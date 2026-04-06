const express = require('express');
const multer = require('multer');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs-extra');
const path = require('path');
const mime = require('mime-types');

const app = express();
const PORT = process.env.PORT || 3000;

// Ensure directories exist
const DATA_DIR = path.join(__dirname, 'data');
const STORAGE_DIR = path.join(__dirname, 'storage');
fs.ensureDirSync(DATA_DIR);
fs.ensureDirSync(STORAGE_DIR);

// Database file path
const DB_FILE = path.join(DATA_DIR, 'database.json');

// Initialize database
if (!fs.existsSync(DB_FILE)) {
  fs.writeJsonSync(DB_FILE, {});
}

// ============= PERFORMANCE OPTIMIZATIONS =============
// User Agent for high-speed concurrent requests
app.use((req, res, next) => {
  req.userAgent = req.headers['user-agent'] || 'public-db-client/1.0';
  res.setHeader('X-Powered-By', 'PublicDB-SuperFast/1.0');
  res.setHeader('X-Response-Time', Date.now());
  next();
});

// Compression for faster responses
app.use(compression({
  level: 6,
  threshold: 1024,
  filter: (req, res) => {
    if (req.headers['x-no-compression']) return false;
    return compression.filter(req, res);
  }
}));

// Security but optimized
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false
}));

// CORS - Allow all for public access
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['*'],
  exposedHeaders: ['X-Total-Count', 'X-Response-Time']
}));

// Parse JSON with increased limit
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// High-performance rate limiter (150+ concurrent requests)
const limiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 500, // 500 requests per minute
  message: { error: 'Too many requests', retryAfter: 60 },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.userAgent === 'stress-test' // Skip for testing
});
app.use('/api/', limiter);

// Async queue for database operations
class AsyncDBQueue {
  constructor() {
    this.queue = [];
    this.processing = false;
  }

  async enqueue(operation) {
    return new Promise((resolve, reject) => {
      this.queue.push({ operation, resolve, reject });
      if (!this.processing) this.process();
    });
  }

  async process() {
    if (this.processing || this.queue.length === 0) return;
    this.processing = true;
    
    while (this.queue.length > 0) {
      const { operation, resolve, reject } = this.queue.shift();
      try {
        const result = await operation();
        resolve(result);
      } catch (error) {
        reject(error);
      }
    }
    
    this.processing = false;
  }
}

const dbQueue = new AsyncDBQueue();

// Database helper functions
const readDB = async () => {
  return await fs.readJson(DB_FILE);
};

const writeDB = async (data) => {
  await fs.writeJson(DB_FILE, data, { spaces: 2 });
};

// ============= DATABASE API (/) =============

// GET all data
app.get('/api/data', async (req, res) => {
  try {
    const db = await readDB();
    res.json({
      success: true,
      count: Object.keys(db).length,
      data: db,
      timestamp: Date.now()
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET specific key
app.get('/api/data/:key', async (req, res) => {
  try {
    const db = await readDB();
    const { key } = req.params;
    
    if (db[key]) {
      res.json({ success: true, key, value: db[key] });
    } else {
      res.status(404).json({ success: false, error: 'Key not found' });
    }
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST/PUT data
app.post('/api/data/:key', async (req, res) => {
  try {
    const { key } = req.params;
    const value = req.body;
    
    const result = await dbQueue.enqueue(async () => {
      const db = await readDB();
      db[key] = {
        value: value,
        metadata: {
          createdAt: db[key]?.metadata?.createdAt || Date.now(),
          updatedAt: Date.now(),
          type: Array.isArray(value) ? 'array' : typeof value
        }
      };
      await writeDB(db);
      return db[key];
    });
    
    res.json({ 
      success: true, 
      key, 
      data: result,
      message: 'Data stored successfully'
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// PUT (update) - alias for POST
app.put('/api/data/:key', async (req, res) => {
  req.method = 'POST';
  app.handle(req, res);
});

// DELETE key
app.delete('/api/data/:key', async (req, res) => {
  try {
    const { key } = req.params;
    
    await dbQueue.enqueue(async () => {
      const db = await readDB();
      delete db[key];
      await writeDB(db);
    });
    
    res.json({ success: true, message: 'Key deleted successfully' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Batch operations
app.post('/api/batch', async (req, res) => {
  try {
    const { operations } = req.body;
    
    if (!Array.isArray(operations)) {
      return res.status(400).json({ error: 'Operations must be an array' });
    }
    
    const results = await dbQueue.enqueue(async () => {
      const db = await readDB();
      const output = [];
      
      for (const op of operations) {
        const { type, key, value } = op;
        
        if (type === 'set') {
          db[key] = {
            value: value,
            metadata: {
              createdAt: db[key]?.metadata?.createdAt || Date.now(),
              updatedAt: Date.now()
            }
          };
          output.push({ key, status: 'updated' });
        } else if (type === 'delete') {
          delete db[key];
          output.push({ key, status: 'deleted' });
        } else if (type === 'get') {
          output.push({ key, value: db[key] });
        }
      }
      
      await writeDB(db);
      return output;
    });
    
    res.json({ success: true, results });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Search data
app.get('/api/search/:query', async (req, res) => {
  try {
    const { query } = req.params;
    const db = await readDB();
    
    const results = {};
    for (const [key, data] of Object.entries(db)) {
      if (key.includes(query) || JSON.stringify(data.value).includes(query)) {
        results[key] = data;
      }
    }
    
    res.json({
      success: true,
      query,
      count: Object.keys(results).length,
      results
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get database stats
app.get('/api/stats', async (req, res) => {
  try {
    const db = await readDB();
    const stats = {
      totalKeys: Object.keys(db).length,
      storagePath: STORAGE_DIR,
      databasePath: DATA_DIR,
      uptime: process.uptime(),
      memoryUsage: process.memoryUsage(),
      timestamp: Date.now()
    };
    res.json(stats);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============= STORAGE API (/storage) =============

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadPath = STORAGE_DIR;
    fs.ensureDirSync(uploadPath);
    cb(null, uploadPath);
  },
  filename: (req, file, cb) => {
    const originalName = Buffer.from(file.originalname, 'latin1').toString('utf8');
    const ext = path.extname(originalName);
    const name = path.basename(originalName, ext);
    const uniqueId = uuidv4().slice(0, 8);
    cb(null, `${name}_${uniqueId}${ext}`);
  }
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 100 * 1024 * 1024 // 100MB max
  },
  fileFilter: (req, file, cb) => {
    // Allow all file types
    cb(null, true);
  }
});

// Upload single file
app.post('/storage/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }
    
    const fileInfo = {
      id: uuidv4(),
      filename: req.file.filename,
      originalName: req.file.originalname,
      size: req.file.size,
      mimeType: mime.lookup(req.file.filename) || 'application/octet-stream',
      uploadDate: Date.now(),
      path: `/storage/files/${req.file.filename}`,
      url: `${req.protocol}://${req.get('host')}/storage/files/${req.file.filename}`
    };
    
    // Store metadata in database
    await dbQueue.enqueue(async () => {
      const db = await readDB();
      if (!db.__files) db.__files = {};
      db.__files[fileInfo.id] = fileInfo;
      await writeDB(db);
    });
    
    res.json({
      success: true,
      file: fileInfo,
      message: 'File uploaded successfully'
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Upload multiple files
app.post('/storage/upload-multiple', upload.array('files', 50), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No files uploaded' });
    }
    
    const filesInfo = [];
    
    for (const file of req.files) {
      const fileInfo = {
        id: uuidv4(),
        filename: file.filename,
        originalName: file.originalname,
        size: file.size,
        mimeType: mime.lookup(file.filename) || 'application/octet-stream',
        uploadDate: Date.now(),
        path: `/storage/files/${file.filename}`,
        url: `${req.protocol}://${req.get('host')}/storage/files/${file.filename}`
      };
      filesInfo.push(fileInfo);
    }
    
    // Store metadata in database
    await dbQueue.enqueue(async () => {
      const db = await readDB();
      if (!db.__files) db.__files = {};
      filesInfo.forEach(fileInfo => {
        db.__files[fileInfo.id] = fileInfo;
      });
      await writeDB(db);
    });
    
    res.json({
      success: true,
      count: filesInfo.length,
      files: filesInfo,
      message: 'Files uploaded successfully'
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get all files list
app.get('/storage/files', async (req, res) => {
  try {
    const db = await readDB();
    const files = db.__files || {};
    
    const filesList = Object.values(files).sort((a, b) => b.uploadDate - a.uploadDate);
    
    res.json({
      success: true,
      count: filesList.length,
      files: filesList
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get single file info
app.get('/storage/files/:id/info', async (req, res) => {
  try {
    const { id } = req.params;
    const db = await readDB();
    const file = db.__files?.[id];
    
    if (!file) {
      return res.status(404).json({ error: 'File not found' });
    }
    
    res.json({ success: true, file });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Serve static files
app.use('/storage/files', express.static(STORAGE_DIR, {
  maxAge: '1d',
  etag: true,
  lastModified: true,
  setHeaders: (res, filePath) => {
    const mimeType = mime.lookup(filePath) || 'application/octet-stream';
    res.setHeader('Content-Type', mimeType);
    res.setHeader('Access-Control-Allow-Origin', '*');
  }
}));

// Download file
app.get('/storage/download/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const db = await readDB();
    const fileInfo = db.__files?.[id];
    
    if (!fileInfo) {
      return res.status(404).json({ error: 'File not found' });
    }
    
    const filePath = path.join(STORAGE_DIR, fileInfo.filename);
    
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'File not found on disk' });
    }
    
    res.download(filePath, fileInfo.originalName);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Delete file
app.delete('/storage/files/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    await dbQueue.enqueue(async () => {
      const db = await readDB();
      const fileInfo = db.__files?.[id];
      
      if (!fileInfo) {
        throw new Error('File not found');
      }
      
      const filePath = path.join(STORAGE_DIR, fileInfo.filename);
      if (fs.existsSync(filePath)) {
        await fs.remove(filePath);
      }
      
      delete db.__files[id];
      await writeDB(db);
    });
    
    res.json({ success: true, message: 'File deleted successfully' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============= WEB INTERFACE =============

// Serve web interface
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: Date.now(),
    uptime: process.uptime(),
    databaseSize: fs.statSync(DB_FILE).size,
    storageSize: fs.statSync(STORAGE_DIR).size
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({
    success: false,
    error: err.message,
    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Public Database Server running on port ${PORT}`);
  console.log(`📁 Database path: ${DATA_DIR}`);
  console.log(`💾 Storage path: ${STORAGE_DIR}`);
  console.log(`🌐 Web Interface: http://localhost:${PORT}`);
  console.log(`⚡ Optimized for 150+ concurrent requests`);
});

module.exports = app;
