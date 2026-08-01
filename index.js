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
// ========================================================
// 📦 Pagination Helper — يجيب كل الصفوف المطابقة بدون ما يعتمد
// على limit() اللي ممكن يترفض جزئيًا حسب إعدادات المشروع.
// بيسحب دفعات (batches) من PAGE_SIZE صف لحد ما يخلص.
// ========================================================
const PAGE_SIZE = 1000;

async function fetchAllPaginated(table, columns, filters = []) {
    let allRows = [];
    let from = 0;
    while (true) {
        let query = supabase.from(table).select(columns).range(from, from + PAGE_SIZE - 1);
        filters.forEach(f => { query = query.eq(f.column, f.value); });
        const { data, error } = await query;
        if (error) throw error;
        if (!data || !data.length) break;
        allRows = allRows.concat(data);
        if (data.length < PAGE_SIZE) break;
        from += PAGE_SIZE;
    }
    return allRows;
}

const ATTENDANCE_COLUMNS = 'student_id, student_name, subject_name, college, hall, target_group, group_name, session_date, attendance_time, status, doctor_uid, doctor_name, notes, is_unruly, is_uniform_violation, level, sis_code, segment_count, feedback_status, feedback_rating, is_suspicious, is_recovered';

async function fetchByEq(column, value) {
    const rows = await fetchAllPaginated('attendance_logs', ATTENDANCE_COLUMNS, [{ column, value }]);
    return rows.map(mapRecord);
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

        const filters = [{ column: 'doctor_name', value: doctorName }];
        if (college) filters.push({ column: 'college', value: college });
        const rows = await fetchAllPaginated('attendance_logs', ATTENDANCE_COLUMNS, filters);

        const all = rows.map(mapRecord);
        const records = filterByDateRange(all, startDate, endDate);

        res.status(200).json({ records });
    } catch (err) {
        console.error('Doctor Report Error:', err.message);
        res.status(500).json({ error: 'فشل جلب بيانات الدكتور من صبابيز' });
    }
});

// ========================================================
// 📍 GET /api/report/doctorRatings
// ?college=(اختياري) — متوسط تقييمات كل دكتور من feedback_rating
// ========================================================
app.get('/api/report/doctorRatings', verifyApiKey, async (req, res) => {
    try {
        const { college } = req.query;

        let queryBuilder = supabase
            .from('attendance_logs')
            .select('doctor_uid, doctor_name, feedback_rating')
            .gt('feedback_rating', 0);
        if (college) queryBuilder = queryBuilder.eq('college', college);

        let ratingRows = [];
        let from = 0;
        while (true) {
            const { data, error } = await queryBuilder.range(from, from + PAGE_SIZE - 1);
            if (error) throw error;
            if (!data || !data.length) break;
            ratingRows = ratingRows.concat(data);
            if (data.length < PAGE_SIZE) break;
            from += PAGE_SIZE;
        }

        const grouped = new Map();
        ratingRows.forEach(row => {
            const uid = row.doctor_uid;
            if (!uid) return;
            if (!grouped.has(uid)) {
                grouped.set(uid, { doctorUID: uid, doctorName: row.doctor_name || '—', sum: 0, count: 0 });
            }
            const g = grouped.get(uid);
            g.sum += Number(row.feedback_rating) || 0;
            g.count += 1;
        });

        const ratings = Array.from(grouped.values()).map(g => {
            const avg = g.count ? g.sum / g.count : 0;
            return {
                doctorUID: g.doctorUID,
                doctorName: g.doctorName,
                avgRating: Math.round(avg * 10) / 10,
                ratingCount: g.count,
                percentage: Math.round((avg / 5) * 100),
            };
        });

        res.status(200).json({ ratings });
    } catch (err) {
        console.error('Doctor Ratings Report Error:', err.message);
        res.status(500).json({ error: 'فشل جلب تقييمات الدكاترة من صبابيز' });
    }
});

// ========================================================
// 📍 GET /api/report/college-attendance
// ?college=NURS — يرجّع ملخص حضور/غياب/انقطاع/مخالفات
// لكل طالب في الكلية دفعة واحدة (بدل طلب منفصل لكل طالب)
// ========================================================
app.get('/api/report/college-attendance', verifyApiKey, async (req, res) => {
    try {
        const { college } = req.query;
        if (!college) return res.status(400).json({ error: 'college مطلوب' });

        const rows = await fetchAllPaginated(
            'attendance_logs',
            'student_id, status, session_date, doctor_name, subject_name, is_unruly',
            [{ column: 'college', value: college }]
        );

        const grouped = new Map();
        const todayStr = (() => {
            const now = new Date();
            const dd = String(now.getDate()).padStart(2, '0');
            const mm = String(now.getMonth() + 1).padStart(2, '0');
            const yyyy = now.getFullYear();
            return `${dd}/${mm}/${yyyy}`;
        })();

        rows.forEach(row => {
            const sid = row.student_id;
            if (!sid) return;
            if (!grouped.has(sid)) {
                grouped.set(sid, { present: 0, absent: 0, lastDate: null, unrulyIncidents: [], todayUnrulyIncidents: [] });
            }
            const g = grouped.get(sid);
            if (row.status === 'ATTENDED') g.present++;
            if (row.status === 'ABSENT') g.absent++;

            const dt = parseDMY(row.session_date);
            if (dt && (!g.lastDate || dt > g.lastDate)) g.lastDate = dt;

            if (row.is_unruly === true) {
                const incident = { doctorName: row.doctor_name, subject: row.subject_name, date: row.session_date };
                g.unrulyIncidents.push(incident);
                if (row.session_date === todayStr) g.todayUnrulyIncidents.push(incident);
            }
        });

        const summaries = {};
        grouped.forEach((g, sid) => {
            const gapDays = g.lastDate ? Math.floor((Date.now() - g.lastDate.getTime()) / (1000 * 60 * 60 * 24)) : null;
            summaries[sid] = {
                present: g.present,
                absent: g.absent,
                gapDays,
                unrulyIncidents: g.unrulyIncidents,
                unrulyCount: g.unrulyIncidents.length,
                todayUnrulyIncidents: g.todayUnrulyIncidents
            };
        });

        res.status(200).json({ summaries });
    } catch (err) {
        console.error('College Attendance Summary Error:', err.message);
        res.status(500).json({ error: 'فشل جلب ملخص حضور الكلية من صبابيز' });
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

        const filters = [{ column: 'subject_name', value: subject }];
        if (college) filters.push({ column: 'college', value: college });
        const rows = await fetchAllPaginated('attendance_logs', ATTENDANCE_COLUMNS, filters);

        const all = rows.map(mapRecord);
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

        const rows = await fetchAllPaginated('attendance_logs', ATTENDANCE_COLUMNS, [
            { column: 'college', value: college },
            { column: 'status', value: 'ABSENT' }
        ]);

        const all = rows.map(mapRecord);
        const records = filterByDateRange(all, startDate, endDate);

        res.status(200).json({ records });
    } catch (err) {
        console.error('College Absences Report Error:', err.message);
        res.status(500).json({ error: 'فشل جلب بيانات الغياب من صبابيز' });
    }
});

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
