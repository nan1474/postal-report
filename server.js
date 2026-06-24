const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const multer = require('multer');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(express.static('public'));

// Data file path
const DATA_FILE = path.join(__dirname, 'data', 'reports.json');

// Ensure data directory and file exist
function ensureDataFile() {
    const dataDir = path.join(__dirname, 'data');
    if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
    }
    if (!fs.existsSync(DATA_FILE)) {
        fs.writeFileSync(DATA_FILE, JSON.stringify([], null, 2));
    }
}

// Generate report number
function generateReportNumber() {
    const now = new Date();
    const dateStr = now.getFullYear().toString() +
                   (now.getMonth() + 1).toString().padStart(2, '0') +
                   now.getDate().toString().padStart(2, '0');
    
    // Read existing reports to get next sequence
    ensureDataFile();
    const reports = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    const todayReports = reports.filter(r => r.id.startsWith('JUB' + dateStr));
    const nextSeq = (todayReports.length + 1).toString().padStart(3, '0');
    
    return 'JUB' + dateStr + nextSeq;
}

// API: Submit report
app.post('/api/reports', (req, res) => {
    try {
        ensureDataFile();
        
        const { type, department, description, isAnonymous, contactName, contactPhone } = req.body;
        
        // Validate required fields
        if (!type || !department || !description) {
            return res.status(400).json({
                success: false,
                message: '缺少必填字段'
            });
        }
        
        // Create report object
        const report = {
            id: generateReportNumber(),
            type: type,
            department: department,
            description: description,
            isAnonymous: isAnonymous || true,
            contactName: contactName || '',
            contactPhone: contactPhone || '',
            status: 'pending', // pending, processing, completed
            submitTime: new Date().toISOString(),
            processLogs: []
        };
        
        // Save to file
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
        
    } catch (error) {
        console.error('Submit report error:', error);
        res.status(500).json({
            success: false,
            message: '服务器错误'
        });
    }
});

// API: Get all reports (admin)
app.get('/api/reports', (req, res) => {
    try {
        ensureDataFile();
        
        const { status, page = 1, limit = 20 } = req.query;
        
        let reports = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
        
        // Filter by status if provided
        if (status && status !== 'all') {
            reports = reports.filter(r => r.status === status);
        }
        
        // Sort by submit time (newest first)
        reports.sort((a, b) => new Date(b.submitTime) - new Date(a.submitTime));
        
        // Pagination
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
        
    } catch (error) {
        console.error('Get reports error:', error);
        res.status(500).json({
            success: false,
            message: '服务器错误'
        });
    }
});

// API: Get single report by ID
app.get('/api/reports/:id', (req, res) => {
    try {
        ensureDataFile();
        
        const { id } = req.params;
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
        
    } catch (error) {
        console.error('Get report error:', error);
        res.status(500).json({
            success: false,
            message: '服务器错误'
        });
    }
});

// API: Update report status (admin)
app.put('/api/reports/:id/status', (req, res) => {
    try {
        ensureDataFile();
        
        const { id } = req.params;
        const { status, comment } = req.body;
        
        const reports = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
        const reportIndex = reports.findIndex(r => r.id === id);
        
        if (reportIndex === -1) {
            return res.status(404).json({
                success: false,
                message: '举报不存在'
            });
        }
        
        // Update status
        reports[reportIndex].status = status;
        
        // Add process log
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
        
    } catch (error) {
        console.error('Update status error:', error);
        res.status(500).json({
            success: false,
            message: '服务器错误'
        });
    }
});

// API: Get statistics (admin)
app.get('/api/stats', (req, res) => {
    try {
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
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Start server
app.listen(PORT, () => {
    console.log('✅ 中国邮政违规经营举报平台启动成功！');
    console.log('📱 员工访问地址：<ADDRESS_REMOVED>
    console.log('🔧 管理后台地址：<ADDRESS_REMOVED>
    console.log('👤 管理员账号：admin');
    console.log('🔑 管理员密码：123456');
});

module.exports = app;
