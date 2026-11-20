const express = require('express');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const { q, withTransaction, setSkills, PROJECT_SKILLS, MEMBER_COUNT } = require('./db');
const { sign, requireAuth } = require('./auth');
const storage = require('./storage');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });
const wrap = fn => (req, res) => fn(req, res).catch(e => {
  console.error(e);
  res.status(e.status || 500).json({ error: e.status ? e.message : 'Something went wrong.' });
});
const fail = (status, message) => Object.assign(new Error(message), { status });

const isMember = async (pid, uid) =>
  (await q('SELECT 1 FROM members WHERE project_id=$1 AND user_id=$2', [pid, uid])).rowCount > 0;
const mustBeMember = async (pid, uid) => { if (!(await isMember(pid, uid))) throw fail(403, 'Only team members can do that.'); };

const userSkills = id => q(
  `SELECT COALESCE(json_agg(s.name ORDER BY s.name), '[]') AS skills FROM user_skills u
   JOIN skills s ON s.id = u.skill_id WHERE u.user_id = $1`, [id]).then(r => r.rows[0].skills);

module.exports = io => {
  const r = express.Router();

  // ---------- auth ----------
  r.post('/auth/register', wrap(async (req, res) => {
    const { name, email, password } = req.body;
    const cleanName = String(name || '').trim();
    const cleanEmail = String(email || '').trim().toLowerCase();
    if (cleanName.length < 2 || cleanName.length > 80 || cleanEmail.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail) ||
        typeof password !== 'string' || password.length < 8 || password.length > 72)
      throw fail(400, 'Enter a valid name, email and a password of 8 to 72 characters.');
    const hash = await bcrypt.hash(password, 12);
    try {
      const { rows } = await q('INSERT INTO users (name,email,password_hash) VALUES ($1,lower($2),$3) RETURNING id,name,email',
        [cleanName, cleanEmail, hash]);
      res.json({ token: sign(rows[0]), user: rows[0] });
    } catch (e) { throw e.code === '23505' ? fail(409, 'That email already has an account.') : e; }
  }));

  r.post('/auth/login', wrap(async (req, res) => {
    const email = String(req.body.email || '').trim().toLowerCase();
    const { rows } = await q('SELECT * FROM users WHERE email = $1', [email]);
    if (!rows[0] || !(await bcrypt.compare(req.body.password || '', rows[0].password_hash)))
      throw fail(401, 'Email or password is incorrect.');
    res.json({ token: sign(rows[0]), user: { id: rows[0].id, name: rows[0].name, email: rows[0].email } });
  }));

  r.use(requireAuth);

  // Files are private to team members. Project cover images are visible to signed-in users.
  r.get('/files/:key', wrap(async (req, res) => {
    const key = req.params.key;
    const image = (await q('SELECT id FROM projects WHERE image_key=$1', [key])).rowCount > 0;
    const file = (await q('SELECT project_id FROM project_files WHERE key=$1', [key])).rows[0];
    if (!image && (!file || !(await isMember(file.project_id, req.userId))))
      throw fail(404, 'File not found.');
    await storage.stream(key, res, { inline: req.query.inline === '1' && image });
  }));

  // ---------- profile ----------
  r.get('/me', wrap(async (req, res) => {
    const { rows } = await q('SELECT id,name,email,major,bio FROM users WHERE id=$1', [req.userId]);
    res.json({ ...rows[0], skills: await userSkills(req.userId) });
  }));

  r.put('/me', wrap(async (req, res) => {
    const { name, major, bio, skills = [] } = req.body;
    const cleanName = String(name || '').trim();
    const cleanSkills = Array.isArray(skills) ? skills.map(s => String(s).trim()).filter(Boolean) : [];
    if (cleanName.length < 2 || cleanName.length > 80) throw fail(400, 'Name must be between 2 and 80 characters.');
    if (String(major || '').length > 120 || String(bio || '').length > 1000)
      throw fail(400, 'Major or bio is too long.');
    if (cleanSkills.length > 30 || cleanSkills.some(s => s.length > 60))
      throw fail(400, 'Add up to 30 skills, each no longer than 60 characters.');
    await withTransaction(async tx => {
      await tx('UPDATE users SET name=$1, major=$2, bio=$3 WHERE id=$4',
        [cleanName, major || '', bio || '', req.userId]);
      await setSkills('user_skills', 'user_id', req.userId, cleanSkills, tx);
    });
    res.json({ ok: true });
  }));

  // ---------- projects ----------
  r.get('/projects', wrap(async (req, res) => {
    const { q: text = '', skill = '' } = req.query;
    const { rows } = await q(
      `SELECT p.*, u.name AS owner_name, ${PROJECT_SKILLS}, ${MEMBER_COUNT}
       FROM projects p JOIN users u ON u.id = p.owner_id
       WHERE p.status='open'
         AND ($1 = '' OR p.title ILIKE '%'||$1||'%' OR p.course ILIKE '%'||$1||'%' OR p.description ILIKE '%'||$1||'%')
         AND ($2 = '' OR EXISTS (SELECT 1 FROM project_skills x JOIN skills s ON s.id=x.skill_id
                                 WHERE x.project_id=p.id AND s.name ILIKE $2))
       ORDER BY p.created_at DESC LIMIT 60`, [text, skill]);
    res.json(rows);
  }));

  r.post('/projects', upload.single('image'), wrap(async (req, res) => {
    const { title, course, description, team_size, deadline } = req.body;
    const cleanTitle = String(title || '').trim();
    const size = Number(team_size || 4);
    if (!cleanTitle || cleanTitle.length > 120) throw fail(400, 'Project title is required and must be under 120 characters.');
    if (!Number.isInteger(size) || size < 2 || size > 12) throw fail(400, 'Team size must be between 2 and 12.');
    if (req.file && !/^image\/(png|jpeg|gif|webp)$/.test(req.file.mimetype)) throw fail(400, 'Cover image must be PNG, JPEG, GIF or WebP.');
    const skillNames = String(req.body.skills || '').split(',').map(s => s.trim()).filter(Boolean);
    if (skillNames.length > 30 || skillNames.some(s => s.length > 60))
      throw fail(400, 'Add up to 30 required skills, each no longer than 60 characters.');
    if (deadline) {
      const parsedDeadline = new Date(`${deadline}T00:00:00Z`);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(deadline) ||
          Number.isNaN(parsedDeadline.getTime()) || parsedDeadline.toISOString().slice(0, 10) !== deadline)
        throw fail(400, 'Deadline must be a valid date.');
    }
    const image_key = req.file ? await storage.put(req.file) : null;
    const id = await withTransaction(async tx => {
      const { rows } = await tx(
        `INSERT INTO projects (owner_id,title,course,description,team_size,deadline,image_key)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
        [req.userId, cleanTitle, String(course || '').slice(0,120), String(description || '').slice(0,5000), size, deadline || null, image_key]);
      const projectId = rows[0].id;
      await tx("INSERT INTO members (project_id,user_id,role) VALUES ($1,$2,'owner')", [projectId, req.userId]);
      await setSkills('project_skills', 'project_id', projectId, skillNames, tx);
      return projectId;
    });
    res.json({ id });
  }));

  r.get('/projects/:id', wrap(async (req, res) => {
    const id = +req.params.id;
    const { rows } = await q(
      `SELECT p.*, u.name AS owner_name, ${PROJECT_SKILLS}, ${MEMBER_COUNT}
       FROM projects p JOIN users u ON u.id=p.owner_id WHERE p.id=$1`, [id]);
    if (!rows[0]) throw fail(404, 'Project not found.');
    const member = await isMember(id, req.userId);
    const out = { ...rows[0], is_member: member };
    out.members = (await q(
      `SELECT u.id,u.name,m.role FROM members m JOIN users u ON u.id=m.user_id WHERE m.project_id=$1`, [id])).rows;
    if (!member) {
      out.my_request = (await q('SELECT status FROM join_requests WHERE project_id=$1 AND user_id=$2', [id, req.userId])).rows[0]?.status || null;
      return res.json(out);
    }
    out.tasks = (await q(
      `SELECT t.*, u.name AS assignee_name FROM tasks t LEFT JOIN users u ON u.id=t.assignee_id
       WHERE t.project_id=$1 ORDER BY t.id`, [id])).rows;
    out.messages = (await q(
      `SELECT * FROM (SELECT m.id,m.body,m.created_at,m.user_id,u.name FROM messages m JOIN users u ON u.id=m.user_id
       WHERE m.project_id=$1 ORDER BY m.id DESC LIMIT 100) x ORDER BY id`, [id])).rows;
    out.files = (await q('SELECT id,key,name FROM project_files WHERE project_id=$1 ORDER BY id DESC', [id])).rows;
    res.json(out);
  }));

  // ---------- matching ----------
  r.get('/matches', wrap(async (req, res) => {
    const { rows } = await q(
      `SELECT p.*, u.name AS owner_name, ${PROJECT_SKILLS}, ${MEMBER_COUNT},
         (SELECT COALESCE(json_agg(s.name), '[]') FROM project_skills x JOIN skills s ON s.id=x.skill_id
            JOIN user_skills us ON us.skill_id=x.skill_id AND us.user_id=$1 WHERE x.project_id=p.id) AS matched_skills,
         ROUND(100.0 * COUNT(us.skill_id) / COUNT(ps.skill_id))::int AS score
       FROM projects p
       JOIN users u ON u.id = p.owner_id
       JOIN project_skills ps ON ps.project_id = p.id
       LEFT JOIN user_skills us ON us.skill_id = ps.skill_id AND us.user_id = $1
       WHERE p.status='open' AND p.owner_id <> $1
         AND NOT EXISTS (SELECT 1 FROM members m WHERE m.project_id=p.id AND m.user_id=$1)
       GROUP BY p.id, u.name HAVING COUNT(us.skill_id) > 0
       ORDER BY score DESC, p.created_at DESC LIMIT 30`, [req.userId]);
    res.json(rows);
  }));

  // ---------- join requests ----------
  r.post('/projects/:id/join', wrap(async (req, res) => {
    const id = +req.params.id;
    const p = (await q('SELECT owner_id,title,status FROM projects WHERE id=$1', [id])).rows[0];
    if (!p || p.status !== 'open') throw fail(400, 'This project is not accepting members.');
    if (await isMember(id, req.userId)) throw fail(400, 'You are already on this team.');
    const message = String(req.body.message || '').trim().slice(0, 1000);
    await q(`INSERT INTO join_requests (project_id,user_id,message) VALUES ($1,$2,$3)
             ON CONFLICT (project_id,user_id) DO UPDATE SET status='pending', message=EXCLUDED.message`,
      [id, req.userId, message]);
    io.to('user:' + p.owner_id).emit('request:new', { project: p.title });
    res.json({ ok: true });
  }));

  r.get('/requests/incoming', wrap(async (req, res) => {
    const { rows } = await q(
      `SELECT jr.id, jr.message, jr.created_at, p.id AS project_id, p.title, u.id AS user_id, u.name, u.major,
         (SELECT COALESCE(json_agg(s.name), '[]') FROM user_skills us JOIN skills s ON s.id=us.skill_id WHERE us.user_id=u.id) AS skills
       FROM join_requests jr JOIN projects p ON p.id=jr.project_id JOIN users u ON u.id=jr.user_id
       WHERE p.owner_id=$1 AND jr.status='pending' ORDER BY jr.created_at`, [req.userId]);
    res.json(rows);
  }));

  r.post('/requests/:id/:decision(accept|reject)', wrap(async (req, res) => {
    const requestId = Number(req.params.id);
    if (!Number.isInteger(requestId) || requestId < 1) throw fail(400, 'Invalid request.');
    const accept = req.params.decision === 'accept';
    const result = await withTransaction(async tx => {
      const found = await tx(
        `SELECT jr.*, p.owner_id, p.team_size, p.status AS project_status
         FROM join_requests jr JOIN projects p ON p.id=jr.project_id
         WHERE jr.id=$1 FOR UPDATE OF p, jr`, [requestId]);
      const jr = found.rows[0];
      if (!jr || jr.owner_id !== req.userId) throw fail(403, 'Only the project owner can answer requests.');
      if (jr.status !== 'pending') throw fail(409, 'This request has already been answered.');
      if (!accept) {
        await tx("UPDATE join_requests SET status='rejected' WHERE id=$1", [jr.id]);
        return { userId: jr.user_id, projectId: jr.project_id, accepted: false };
      }
      if (jr.project_status !== 'open') throw fail(409, 'This project is no longer accepting members.');
      const count = await tx('SELECT COUNT(*)::int AS n FROM members WHERE project_id=$1', [jr.project_id]);
      if (count.rows[0].n >= jr.team_size) {
        await tx("UPDATE projects SET status='full' WHERE id=$1", [jr.project_id]);
        return { error: 'The team is already full.' };
      }
      await tx('INSERT INTO members (project_id,user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
        [jr.project_id, jr.user_id]);
      await tx("UPDATE join_requests SET status='accepted' WHERE id=$1", [jr.id]);
      const after = await tx('SELECT COUNT(*)::int AS n FROM members WHERE project_id=$1', [jr.project_id]);
      if (after.rows[0].n >= jr.team_size)
        await tx("UPDATE projects SET status='full' WHERE id=$1", [jr.project_id]);
      return { userId: jr.user_id, projectId: jr.project_id, accepted: true };
    });
    if (result.error) throw fail(409, result.error);
    io.to('user:' + result.userId).emit('request:update', {
      project_id: result.projectId, accepted: result.accepted
    });
    res.json({ ok: true });
  }));

  r.get('/my/projects', wrap(async (req, res) => {
    const { rows } = await q(
      `SELECT p.*, m.role, ${PROJECT_SKILLS}, ${MEMBER_COUNT},
         (SELECT COUNT(*) FILTER (WHERE status='done') || '/' || COUNT(*) FROM tasks t WHERE t.project_id=p.id) AS progress
       FROM members m JOIN projects p ON p.id=m.project_id WHERE m.user_id=$1 ORDER BY p.created_at DESC`, [req.userId]);
    res.json(rows);
  }));

  // ---------- tasks ----------
  r.post('/projects/:id/tasks', wrap(async (req, res) => {
    const id = +req.params.id;
    await mustBeMember(id, req.userId);
    const title = String(req.body.title || '').trim();
    if (!title || title.length > 160) throw fail(400, 'Task title is required and must be under 160 characters.');
    const assignee = req.body.assignee_id ? Number(req.body.assignee_id) : null;
    if (assignee !== null) {
      if (!Number.isInteger(assignee) || !(await isMember(id, assignee)))
        throw fail(400, 'The assignee must be a member of this project.');
    }
    await q('INSERT INTO tasks (project_id,title,assignee_id,due_date) VALUES ($1,$2,$3,$4)',
      [id, title, assignee, req.body.due_date || null]);
    io.to('project:' + id).emit('tasks:changed');
    res.json({ ok: true });
  }));

  r.patch('/tasks/:id', wrap(async (req, res) => {
    const taskId = Number(req.params.id);
    if (!Number.isInteger(taskId) || taskId < 1) throw fail(400, 'Invalid task.');
    const t = (await q('SELECT project_id FROM tasks WHERE id=$1', [taskId])).rows[0];
    if (!t) throw fail(404, 'Task not found.');
    await mustBeMember(t.project_id, req.userId);
    const { status, assignee_id } = req.body;
    if (status !== undefined && !['todo', 'doing', 'done'].includes(status))
      throw fail(400, 'Invalid task status.');
    let assignee = assignee_id;
    if (assignee_id !== undefined) {
      assignee = assignee_id === '' || assignee_id === null ? null : Number(assignee_id);
      if (assignee !== null && (!Number.isInteger(assignee) || !(await isMember(t.project_id, assignee))))
        throw fail(400, 'The assignee must be a member of this project.');
    }
    await q(
      `UPDATE tasks SET status=COALESCE($1,status),
       assignee_id=CASE WHEN $3 THEN $2 ELSE assignee_id END WHERE id=$4`,
      [status || null, assignee ?? null, assignee_id !== undefined, taskId]
    );
    io.to('project:' + t.project_id).emit('tasks:changed');
    res.json({ ok: true });
  }));

  // ---------- files ----------
  r.post('/projects/:id/files', upload.single('file'), wrap(async (req, res) => {
    const id = +req.params.id;
    await mustBeMember(id, req.userId);
    if (!req.file) throw fail(400, 'Choose a file to upload.');
    const key = await storage.put(req.file);
    await q('INSERT INTO project_files (project_id,key,name,uploaded_by) VALUES ($1,$2,$3,$4)',
      [id, key, req.file.originalname, req.userId]);
    io.to('project:' + id).emit('files:changed');
    res.json({ ok: true });
  }));

  r.use((error, req, res, next) => {
    if (error instanceof multer.MulterError) {
      const message = error.code === 'LIMIT_FILE_SIZE' ? 'File is too large (maximum 20 MB).' : 'Invalid file upload.';
      return res.status(400).json({ error: message });
    }
    console.error(error);
    res.status(error.status || 500).json({ error: error.status ? error.message : 'Something went wrong.' });
  });

  return r;
};
