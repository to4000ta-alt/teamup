const cron = require('node-cron');
const { q } = require('./db');
const { verify } = require('./auth');

function setupSockets(io) {
  io.use((socket, next) => {
    try {
      const payload = verify(socket.handshake.auth?.token || '');
      socket.userId = Number(payload.id);
      if (!Number.isInteger(socket.userId)) throw new Error('Invalid user');
      next();
    } catch {
      next(new Error('unauthorized'));
    }
  });

  io.on('connection', socket => {
    socket.join('user:' + socket.userId);

    socket.on('project:join', async projectId => {
      try {
        const id = Number(projectId);
        if (!Number.isInteger(id) || id < 1) return;
        const ok = (await q(
          'SELECT 1 FROM members WHERE project_id=$1 AND user_id=$2',
          [id, socket.userId]
        )).rowCount;
        if (ok) socket.join('project:' + id);
      } catch (error) {
        console.error('Socket project join failed:', error.message);
      }
    });

    socket.on('chat', async payload => {
      try {
        const projectId = Number(payload?.projectId);
        const body = String(payload?.body || '').trim().slice(0, 2000);
        if (!Number.isInteger(projectId) || projectId < 1 || !body ||
            !socket.rooms.has('project:' + projectId)) return;
        const { rows } = await q(
          `WITH m AS (
             INSERT INTO messages (project_id,user_id,body) VALUES ($1,$2,$3) RETURNING *
           )
           SELECT m.id,m.body,m.created_at,m.user_id,u.name
           FROM m JOIN users u ON u.id=m.user_id`,
          [projectId, socket.userId, body]
        );
        io.to('project:' + projectId).emit('chat', { projectId, ...rows[0] });
      } catch (error) {
        console.error('Socket chat failed:', error.message);
      }
    });
  });
}

// Every 30 min, notify assignees about unfinished tasks due within 24 hours.
function setupCron(io) {
  cron.schedule('*/30 * * * *', async () => {
    try {
      const { rows } = await q(
        `UPDATE tasks t SET reminded = true
         FROM projects p
         WHERE p.id = t.project_id AND NOT t.reminded AND t.status <> 'done'
           AND t.assignee_id IS NOT NULL AND t.due_date <= CURRENT_DATE + 1
         RETURNING t.title, t.due_date, t.assignee_id, p.title AS project`
      );
      for (const task of rows) io.to('user:' + task.assignee_id).emit('reminder', task);
      if (rows.length) console.log(`Sent ${rows.length} task reminders.`);
    } catch (error) {
      console.error('Reminder job failed:', error.message);
    }
  });
}

module.exports = { setupSockets, setupCron };
