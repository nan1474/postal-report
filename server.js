const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Database configuration - use PostgreSQL if DATABASE_URL is provided, otherwise use file-based storage
let useDatabase = false;
let pool = null;

if (process.env.DATABASE_URL) {
    const { Pool } = require('pg');
    pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: {
            rejectUnauthorized: false
        }
    });
    useDatabase = true;
    
    // Initialize database table
    initDatabase();
}

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(express.static('public'));

// Data file path (fallback if no database)
const DATA_FILE = path.join(__dirname, 'data', 'reports.json');

// Ensure data directory and file exist (for file-based storage)
function ensureDataFile() {
    const dataDir = path.join(__dirname, 'data');
    if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
    }
    if (!fs.existsSync(DATA_FILE)) {
        fs.writeFileSync(DATA_FILE, JSON.stringify([], null, 2));
    }
}

// Initialize PostgreSQL database
async function initDatabase() {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS reports (
                id VARCHAR(255) PRIMARY KEY,
                type VARCHAR(255),
                department VARCHAR(255),
                description TEXT,
                is_anonymous BOOLEAN DEFAULT true,
                contact_name VARCHAR(255),
                contact_phone VARCHAR(255),
                status VARCHAR(50) DEFAULT 'pending',
                submit_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                process_logs JSONB DEFAULT '[]'::jsonb
            );
        `);
        console.log('✅ Database initialized successfully');
    } catch (error) {
        console.error('❌ Database initialization error:', error);
    }
}

// Generate report number
function generateReportNumber() {
    const now = new Date();
    const dateStr = now.getFullYear().toString() +
                   (now.getMonth() + 1).toString().padStart(2, '0') +
                   now.getDate().toString().padStart(2, '0');
    
    if (useDatabase) {
        // For database mode, we'll generate the ID in the insert query
        return 'JUB' + dateStr;
    } else {
        // For file mode
        ensureDataFile();
        const reports = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
        const todayReports = reports.filter(r => r.id.startsWith('JUB' + dateStr));
        const nextSeq = (todayReports.length + 1).toString().padStart(3, '0');
        
        return 'JUB' + dateStr + nextSeq;
    }
}

// API: Submit report
app.post('/api/reports', async (req, res) => {
    try {
        const { type, department, description, isAnonymous, contactName, contactPhone } = req.body;
        
        // Validate required fields
        if (!type || !department || !description) {
            return res.status(400).json({
                success: false,
                message: '缺少必填字段'
            });
        }
        
        const reportId = generateReportNumber();
        const submitTime = new Date();
        
        if (useDatabase) {
            // Database mode
            const now = new Date();
            const dateStr = now.getFullYear().toString() +
                           (now.getMonth() + 1).toString().padStart(2, '0') +
                           now.getDate().toString().padStart(2, '0');
            
            // Get next sequence number
            const countResult = await pool.query(
                "SELECT COUNT(*) FROM reports WHERE id LIKE $1",
                ['JUB' + dateStr + '%']
            );
            const nextSeq = (parseInt(countResult.rows[0].count) + 1).toString().padStart(3, '0');
            const fullReportId = 'JUB' + dateStr + nextSeq;
            
            await pool.query(`
                INSERT INTO reports (id, type, department, description, is_anonymous, contact_name, contact_phone, status, submit_time, process_logs)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
            `, [
                fullReportId,
                type,
                department,
                description,
                isAnonymous || false,
                contactName || '',
                contactPhone || '',
                'pending',
                submitTime,
                JSON.stringify([])
            ]);
            
            res.json({
                success: true,
                message: '举报提交成功',
                data: {
                    id: fullReportId,
                    submitTime: submitTime.toISOString()
                }
            });
        } else {
            // File mode (fallback)
            ensureDataFile();
            
            const report = {
                id: reportId,
                type: type,
                department: department,
                description: description,
                isAnonymous: isAnonymous || true,
                contactName: contactName || '',
                contactPhone: contactPhone || '',
                status: 'pending',
                submitTime: submitTime.toISOString(),
                processLogs: []
            };
            
            const reports = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
            reports.push(report);
            fs.writeFileSync(DATA_FILE, JSON.stringify(reports, null, 2));
            
            res.json({
                success: true,
                message: '举报提交成功',
                data: {
                    id: report.id,
                    submitTime: report.submitTime
                }
            });
        }
        
    } catch (error) {
        console.error('Submit report error:', error);
        res.status(500).json({
            success: false,
            message: '服务器错误'
        });
    }
});

// API: Get all reports (admin)
app.get('/api/reports', async (req, res) => {
    try {
        const { status, page = 1, limit = 20 } = req.query;
        
        if (useDatabase) {
            // Database mode
            let query = 'SELECT * FROM reports';
            let countQuery = 'SELECT COUNT(*) FROM reports';
            const params = [];
            
            if (status && status !== 'all') {
                query += ' WHERE status = $1';
                countQuery += ' WHERE status = $1';
                params.push(status);
            }
            
            query += ' ORDER BY submit_time DESC';
            
            const offset = (page - 1) * limit;
            query += ` LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
            params.push(limit, offset);
            
            const result = await pool.query(query, params);
            const countResult = await pool.query(
                countQuery,
                status && status !== 'all' ? [status] : []
            );
            
            res.json({
                success: true,
                data: result.rows,
                total: parseInt(countResult.rows[0].count),
                page: parseInt(page),
                limit: parseInt(limit)
            });
        } else {
            // File mode (fallback)
            ensureDataFile();
            
            let reports = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
            
            if (status && status !== 'all') {
                reports = reports.filter(r => r.status === status);
            }
            
            reports.sort((a, b) => new Date(b.submitTime) - new Date(a.submitTime));
            
            const startIndex = (page - 1) * limit;
            const endIndex = page * limit;
            const paginatedReports = reports.slice(startIndex, endIndex);
            
            res.json({
                success: true,
                data: paginatedReports,
                total: reports.length,
                page: parseInt(page),
                limit: parseInt(limit)
            });
        }
        
    } catch (error) {
        console.error('Get reports error:', error);
        res.status(500).json({
            success: false,
            message: '服务器错误'
        });
    }
});

// API: Get single report by ID
app.get('/api/reports/:id', async (req, res) => {
    try {
        const { id } = req.params;
        
        if (useDatabase) {
            const result = await pool.query('SELECT * FROM reports WHERE id = $1', [id]);
            
            if (result.rows.length === 0) {
                return res.status(404).json({
                    success: false,
                    message: '举报不存在'
                });
            }
            
            res.json({
                success: true,
                data: result.rows[0]
            });
        } else {
            ensureDataFile();
            
            const reports = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
            const report = reports.find(r => r.id === id);
            
            if (!report) {
                return res.status(404).json({
                    success: false,
                    message: '举报不存在'
                });
            }
            
            res.json({
                success: true,
                data: report
            });
        }
        
    } catch (error) {
        console.error('Get report error:', error);
        res.status(500).json({
            success: false,
            message: '服务器错误'
        });
    }
});

// API: Update report status (admin)
app.put('/api/reports/:id/status', async (req, res) => {
    try {
        const { id } = req.params;
        const { status, comment } = req.body;
        
        if (useDatabase) {
            const result = await pool.query('SELECT * FROM reports WHERE id = $1', [id]);
            
            if (result.rows.length === 0) {
                return res.status(404).json({
                    success: false,
                    message: '举报不存在'
                });
            }
            
            const report = result.rows[0];
            const processLogs = report.process_logs || [];
            
            if (comment) {
                processLogs.push({
                    time: new Date().toISOString(),
                    action: 'status_update',
                    comment: comment
                });
            }
            
            await pool.query(
                'UPDATE reports SET status = $1, process_logs = $2 WHERE id = $3',
                [status, JSON.stringify(processLogs), id]
            );
            
            res.json({
                success: true,
                message: '状态更新成功'
            });
        } else {
            // File mode (fallback)
            ensureDataFile();
            
            const reports = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
            const reportIndex = reports.findIndex(r => r.id === id);
            
            if (reportIndex === -1) {
                return res.status(404).json({
                    success: false,
                    message: '举报不存在'
                });
            }
            
            reports[reportIndex].status = status;
            
            if (comment) {
                if (!reports[reportIndex].processLogs) {
                    reports[reportIndex].processLogs = [];
                }
                reports[reportIndex].processLogs.push({
                    time: new Date().toISOString(),
                    action: 'status_update',
                    comment: comment
                });
            }
            
            fs.writeFileSync(DATA_FILE, JSON.stringify(reports, null, 2));
            
            res.json({
                success: true,
                message: '状态更新成功'
            });
        }
        
    } catch (error) {
        console.error('Update status error:', error);
        res.status(500).json({
            success: false,
            message: '服务器错误'
        });
    }
});

// API: Get statistics (admin)
app.get('/api/stats', async (req, res) => {
    try {
        if (useDatabase) {
            const result = await pool.query(`
                SELECT 
                    COUNT(*) as total,
                    COUNT(*) FILTER (WHERE status = 'pending') as pending,
                    COUNT(*) FILTER (WHERE status = 'processing') as processing,
                    COUNT(*) FILTER (WHERE status = 'completed') as completed
                FROM reports
            `);
            
            res.json({
                success: true,
                data: result.rows[0]
            });
        } else {
            // File mode (fallback)
            ensureDataFile();
            
            const reports = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
            
            const stats = {
                total: reports.length,
                pending: reports.filter(r => r.status === 'pending').length,
                processing: reports.filter(r => r.status === 'processing').length,
                completed: reports.filter(r => r.status === 'completed').length
            };
            
            res.json({
                success: true,
                data: stats
            });
        }
        
    } catch (error) {
        console.error('Get stats error:', error);
        res.status(500).json({
            success: false,
            message: '服务器错误'
        });
    }
});

// Health check
app.get('/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        timestamp: new Date().toISOString(),
        database: useDatabase ? 'postgresql' : 'file'
    });
});

// Start server
app.listen(PORT, () => {
    console.log('✅ 中国邮政违规经营举报平台启动成功！');
    console.log(`📦 存储模式: ${useDatabase ? 'PostgreSQL数据库' : '文件存储'}`);
    console.log('📱 员工访问地址：<ADDRESS_REMOVED>
    console.log('🔧 管理后台地址：<ADDRESS_REMOVED>
    console.log('👤 管理员账号：admin');
    console.log('🔑 管理员密码：123456');
});

module.exports = app;
