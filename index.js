// ========================================================
// 🏛️ Dean Reports Backend - Independent Supabase Reader
// ✅ Read-only service. Serves attendance reports to the
//    Dean Analytics frontend from a SEPARATE Supabase project.
// ========================================================

const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const DEAN_API_KEY = process.env.DEAN_API_KEY || '';

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error('❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars.');
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const app = express();
app.use(cors({ origin: true }));
app.use(bodyParser.json());

// ========================================================
// 🔐 API Key Middleware
// كل الطلبات لازم تبعت الهيدر: x-api-key
// ========================================================
const verifyApiKey = (req, res, next) => {
    const key = req.headers['x-api-key'];
    if (!DEAN_API_KEY) {
        console.warn('⚠️ DEAN_API_KEY not configured on server — rejecting all requests.');
        return res.status(500).json({ error: 'Server not configured' });
    }
    if (!key || key !== DEAN_API_KEY) {
        return res.status(401).json({ error: 'Unauthorized — missing or invalid API key' });
    }
    next();
};

app.get('/', (req, res) => {
    res.status(200).send('🏛️ Dean Reports Backend (Supabase Reader) is Running');
});

// ========================================================
// 🧠 Helpers
// ========================================================

// بيحول صف Supabase (attendance_logs) لنفس الشكل اللي الفرونت إند
// شغال بيه حاليًا مع Firestore، عشان مفيش حاجة تتلمس في المعالجة هناك.
function mapRecord(row) {
    return {
        id: row.student_id || '',
        studentID: row.student_id || '',
        name: row.student_name || '—',
        subject: row.subject_name || '—',
        college: row.college || '',
        hall: row.hall || '',
        group: row.target_group || row.group_name || 'General',
        date: row.session_date || '',
        time_str: row.attendance_time || '--:--',
        status: row.status || 'ATTENDED',
        doctorUID: row.doctor_uid || '',
        doctorName: row.doctor_name || '—',
        notes: row.notes || '',
        isUnruly: row.is_unruly === true,
        isUniformViolation: row.is_uniform_violation === true,
        academic_level: row.level || '—',
        sisCode: row.sis_code || '',
        segment_count: row.segment_count || 1,
        feedback_status: row.feedback_status || 'none',
        feedback_rating: row.feedback_rating || 0,
        isSuspicious: row.is_suspicious === true,
        isRecovered: row.is_recovered === true,
    };
}

// session_date متخزنة كنص "DD/MM/YYYY" — بنحولها لـ Date للمقارنة
function parseDMY(str) {
    if (!str) return null;
    const parts = String(str).split('/');
    if (parts.length !== 3) return null;
    const [d, m, y] = parts;
    const dt = new Date(`${y}-${m}-${d}`);
    return isNaN(dt.getTime()) ? null : dt;
}

function filterByDateRange(records, startDate, endDate) {
    if (!startDate || !endDate) return records;
    const s = new Date(startDate);
    const e = new Date(endDate);
    e.setHours(23, 59, 59, 999);
    return records.filter(r => {
        const rd = parseDMY(r.date);
        if (!rd) return false;
        return rd >= s && rd <= e;
    });
}

async function fetchByEq(column, value) {
    const { data, error } = await supabase
        .from('attendance_logs')
        .select('*')
        .eq(column, value)
        .limit(5000);
    if (error) throw error;
    return (data || []).map(mapRecord);
}

// ========================================================
// 📍 GET /api/report/student
// ?studentId=...&startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
// ========================================================
app.get('/api/report/student', verifyApiKey, async (req, res) => {
    try {
        const { studentId, startDate, endDate } = req.query;
        if (!studentId) return res.status(400).json({ error: 'studentId مطلوب' });

        const all = await fetchByEq('student_id', studentId);
        const records = filterByDateRange(all, startDate, endDate);

        res.status(200).json({ records });
    } catch (err) {
        console.error('Student Report Error:', err.message);
        res.status(500).json({ error: 'فشل جلب بيانات الطالب من صبابيز' });
    }
});

// ========================================================
// 📍 GET /api/report/doctor
// ?doctorName=...&startDate=...&endDate=...&college=(اختياري)
// ========================================================
app.get('/api/report/doctor', verifyApiKey, async (req, res) => {
    try {
        const { doctorName, startDate, endDate, college } = req.query;
        if (!doctorName) return res.status(400).json({ error: 'doctorName مطلوب' });

        let query = supabase.from('attendance_logs').select('*').eq('doctor_name', doctorName).limit(5000);
        if (college) query = query.eq('college', college);

        const { data, error } = await query;
        if (error) throw error;

        const all = (data || []).map(mapRecord);
        const records = filterByDateRange(all, startDate, endDate);

        res.status(200).json({ records });
    } catch (err) {
        console.error('Doctor Report Error:', err.message);
        res.status(500).json({ error: 'فشل جلب بيانات الدكتور من صبابيز' });
    }
});

// ========================================================
// 📍 GET /api/report/subject
// ?subject=...&startDate=...&endDate=...&college=(اختياري)
// ========================================================
app.get('/api/report/subject', verifyApiKey, async (req, res) => {
    try {
        const { subject, startDate, endDate, college } = req.query;
        if (!subject) return res.status(400).json({ error: 'subject مطلوب' });

        let query = supabase.from('attendance_logs').select('*').eq('subject_name', subject).limit(5000);
        if (college) query = query.eq('college', college);

        const { data, error } = await query;
        if (error) throw error;

        const all = (data || []).map(mapRecord);
        const records = filterByDateRange(all, startDate, endDate);

        res.status(200).json({ records });
    } catch (err) {
        console.error('Subject Report Error:', err.message);
        res.status(500).json({ error: 'فشل جلب بيانات المادة من صبابيز' });
    }
});

// ========================================================
// 📍 GET /api/report/college
// ?college=...&startDate=...&endDate=...
// ========================================================
app.get('/api/report/college', verifyApiKey, async (req, res) => {
    try {
        const { college, startDate, endDate } = req.query;
        if (!college) return res.status(400).json({ error: 'college مطلوب' });

        const all = await fetchByEq('college', college);
        const records = filterByDateRange(all, startDate, endDate);

        res.status(200).json({ records });
    } catch (err) {
        console.error('College Report Error:', err.message);
        res.status(500).json({ error: 'فشل جلب بيانات الكلية من صبابيز' });
    }
});

// ========================================================
// 📍 GET /api/report/college-absences
// ?college=...&startDate=...&endDate=...
// نفس endpoint الكلية بس بيرجع الغياب بس (الفلترة نفسها ممكن
// تتعمل في الفرونت، لكن سيبناها هنا كمان توفيرًا لحجم البيانات)
// ========================================================
app.get('/api/report/college-absences', verifyApiKey, async (req, res) => {
    try {
        const { college, startDate, endDate } = req.query;
        if (!college) return res.status(400).json({ error: 'college مطلوب' });

        const { data, error } = await supabase
            .from('attendance_logs')
            .select('*')
            .eq('college', college)
            .eq('status', 'ABSENT')
            .limit(5000);
        if (error) throw error;

        const all = (data || []).map(mapRecord);
        const records = filterByDateRange(all, startDate, endDate);

        res.status(200).json({ records });
    } catch (err) {
        console.error('College Absences Report Error:', err.message);
        res.status(500).json({ error: 'فشل جلب بيانات الغياب من صبابيز' });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🏛️ Dean Reports Backend running on port ${PORT}`));

module.exports = app;