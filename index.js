// ========================================================
// 🏛️ Dean Reports Backend - Independent Supabase Reader
// ✅ Read-only service. Serves attendance reports to the
//    Dean Analytics frontend from a SEPARATE Supabase project.
// ========================================================

require('dotenv').config();

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

// ========================================================
// 📚 Subject Catalog & Student Course Completion Endpoints
// ✅ يُضاف هذا الكود داخل نفس ملف الباك إند الحالي
//    (نفس الملف اللي فيه verifyApiKey و supabase client)
// ========================================================

// ضع هذا الكود بعد تعريف middleware الـ verifyApiKey مباشرة،
// وقبل سطر: const PORT = process.env.PORT || 3000;

// --------------------------------------------------------
// 🧠 Helpers
// --------------------------------------------------------
function mapCatalogRow(row) {
    return {
        id: row.id,
        college: row.college,
        subjectName: row.subject_name,
        category: row.category || null,
        prerequisiteSubject: row.prerequisite_subject || null,
        updatedAt: row.updated_at,
    };
}

function mapCompletionRow(row) {
    return {
        id: row.id,
        studentId: row.student_id,
        studentName: row.student_name,
        college: row.college,
        subjectName: row.subject_name,
        passed: row.passed === true,
        updatedBy: row.updated_by || null,
        updatedAt: row.updated_at,
    };
}

// ========================================================
// 📍 GET /api/subjects/catalog?college=NURS
// بيرجع كل مواد الكلية اللي ليها تصنيف/متطلب سابق محفوظ
// ========================================================
app.get('/api/subjects/catalog', verifyApiKey, async (req, res) => {
    try {
        const { college } = req.query;
        if (!college) return res.status(400).json({ error: 'college مطلوب' });

        const { data, error } = await supabase
            .from('subject_catalog')
            .select('*')
            .eq('college', college)
            .order('subject_name', { ascending: true });
        if (error) throw error;

        res.status(200).json({ subjects: (data || []).map(mapCatalogRow) });
    } catch (err) {
        console.error('Get Catalog Error:', err.message);
        res.status(500).json({ error: 'فشل جلب كتالوج المواد' });
    }
});

// ========================================================
// 📍 POST /api/subjects/catalog
// body: { college, subjectName, category, prerequisiteSubject }
// upsert لصف واحد (تصنيف / متطلب سابق لمادة معينة)
// ========================================================
app.post('/api/subjects/catalog', verifyApiKey, async (req, res) => {
    try {
        const { college, subjectName, category, prerequisiteSubject } = req.body;
        if (!college || !subjectName) {
            return res.status(400).json({ error: 'college و subjectName مطلوبين' });
        }
        if (prerequisiteSubject && prerequisiteSubject === subjectName) {
            return res.status(400).json({ error: 'لا يمكن أن تكون المادة متطلبًا سابقًا لنفسها' });
        }

        const { data, error } = await supabase
            .from('subject_catalog')
            .upsert({
                college,
                subject_name: subjectName,
                category: category || null,
                prerequisite_subject: prerequisiteSubject || null,
                updated_at: new Date().toISOString(),
            }, { onConflict: 'college,subject_name' })
            .select()
            .single();
        if (error) throw error;

        res.status(200).json({ subject: mapCatalogRow(data) });
    } catch (err) {
        console.error('Upsert Catalog Error:', err.message);
        res.status(500).json({ error: 'فشل حفظ بيانات المادة' });
    }
});

// ========================================================
// 📍 GET /api/subjects/completion?studentId=...&college=...
// بيرجع حالة اجتياز الطالب لكل مواد كليته (اللي عليها سجل)
// ========================================================
app.get('/api/subjects/completion', verifyApiKey, async (req, res) => {
    try {
        const { studentId, college } = req.query;
        if (!studentId || !college) {
            return res.status(400).json({ error: 'studentId و college مطلوبين' });
        }

        const { data, error } = await supabase
            .from('student_course_completion')
            .select('*')
            .eq('student_id', studentId)
            .eq('college', college);
        if (error) throw error;

        res.status(200).json({ completions: (data || []).map(mapCompletionRow) });
    } catch (err) {
        console.error('Get Completion Error:', err.message);
        res.status(500).json({ error: 'فشل جلب حالة الاجتياز' });
    }
});

app.post('/api/subjects/completion', verifyApiKey, async (req, res) => {
    try {
        const { studentId, studentName, college, subjectName, passed, updatedBy } = req.body;
        if (!studentId || !college || !subjectName) {
            return res.status(400).json({ error: 'studentId و college و subjectName مطلوبين' });
        }

        if (passed === true) {
            const { data: catalogRow, error: catalogErr } = await supabase
                .from('subject_catalog')
                .select('prerequisite_subject')
                .eq('college', college)
                .eq('subject_name', subjectName)
                .maybeSingle();
            if (catalogErr) throw catalogErr;

            const prereq = catalogRow?.prerequisite_subject;
            if (prereq) {
                const { data: prereqRow, error: prereqErr } = await supabase
                    .from('student_course_completion')
                    .select('passed')
                    .eq('student_id', studentId)
                    .eq('college', college)
                    .eq('subject_name', prereq)
                    .maybeSingle();
                if (prereqErr) throw prereqErr;

                if (!prereqRow || prereqRow.passed !== true) {
                    return res.status(409).json({
                        error: `لا يمكن اجتياز "${subjectName}" — يجب اجتياز "${prereq}" أولاً`,
                        prerequisiteSubject: prereq,
                    });
                }
            }
        }

        const { data, error } = await supabase
            .from('student_course_completion')
            .upsert({
                student_id: studentId,
                student_name: studentName || null,
                college,
                subject_name: subjectName,
                passed: passed === true,
                updated_by: updatedBy || null,
                updated_at: new Date().toISOString(),
            }, { onConflict: 'student_id,subject_name,college' })
            .select()
            .single();
        if (error) throw error;

        res.status(200).json({ completion: mapCompletionRow(data) });
    } catch (err) {
        console.error('Upsert Completion Error:', err.message);
        res.status(500).json({ error: 'فشل حفظ حالة الاجتياز' });
    }
});
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🏛️ Dean Reports Backend running on port ${PORT}`));

module.exports = app;
