const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const sql = require('mssql');

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

const JWT_SECRET = process.env.JWT_SECRET || 'taskmaster_secret_key_2026_super_secure';

const config = {
  server: 'db68359.public.databaseasp.net',
  database: 'db68359',
  user: 'db68359',
  password: 'jK?6S=2n5Yw+',
  options: {
    encrypt: true,
    trustServerCertificate: true,
    enableArithAbort: true
  },
  pool: {
    max: 10,
    min: 0,
    idleTimeoutMillis: 30000
  },
  connectionTimeout: 60000,
  requestTimeout: 60000
};

let pool = null;
let dbReady = false;

async function getPool() {
  if (pool) return pool;
  try {
    pool = await sql.connect(config);
    dbReady = true;
    console.log('Connected to SQL Server');
    await initDatabase();
    return pool;
  } catch (err) {
    console.error('Database connection failed:', err.message);
    dbReady = false;
    throw err;
  }
}

async function initDatabase() {
  try {
    const db = pool;
    console.log('Creating tables if not exist...');

    await db.query(`
      IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='Users' AND xtype='U')
      CREATE TABLE Users (
        id NVARCHAR(50) PRIMARY KEY,
        name NVARCHAR(100) NOT NULL,
        email NVARCHAR(100) UNIQUE NOT NULL,
        password NVARCHAR(255) NOT NULL,
        created_at DATETIME2 DEFAULT GETDATE()
      )
    `);

    await db.query(`
      IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='Todos' AND xtype='U')
      CREATE TABLE Todos (
        id NVARCHAR(50) PRIMARY KEY,
        user_id NVARCHAR(50) NOT NULL,
        title NVARCHAR(200) NOT NULL,
        description NVARCHAR(MAX) DEFAULT '',
        due_date DATETIME2,
        created_at DATETIME2 DEFAULT GETDATE(),
        priority INT DEFAULT 1,
        category INT DEFAULT 0,
        is_completed BIT DEFAULT 0,
        is_starred BIT DEFAULT 0,
        sub_tasks NVARCHAR(MAX) DEFAULT '[]',
        repeat_type INT DEFAULT 0,
        reminder_time DATETIME2,
        tags NVARCHAR(MAX) DEFAULT '[]',
        is_synced BIT DEFAULT 1,
        FOREIGN KEY (user_id) REFERENCES Users(id) ON DELETE CASCADE
      )
    `);

    await db.query(`
      IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='Appointments' AND xtype='U')
      CREATE TABLE Appointments (
        id NVARCHAR(50) PRIMARY KEY,
        user_id NVARCHAR(50) NOT NULL,
        title NVARCHAR(200) NOT NULL,
        description NVARCHAR(MAX) DEFAULT '',
        start_time DATETIME2,
        end_time DATETIME2,
        location NVARCHAR(200) DEFAULT '',
        type INT DEFAULT 0,
        status INT DEFAULT 0,
        contact_name NVARCHAR(100) DEFAULT '',
        contact_phone NVARCHAR(20) DEFAULT '',
        notes NVARCHAR(MAX) DEFAULT '',
        is_reminder_enabled BIT DEFAULT 1,
        created_at DATETIME2 DEFAULT GETDATE(),
        is_synced BIT DEFAULT 1,
        FOREIGN KEY (user_id) REFERENCES Users(id) ON DELETE CASCADE
      )
    `);

    await db.query(`
      IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='Templates' AND xtype='U')
      CREATE TABLE Templates (
        id NVARCHAR(50) PRIMARY KEY,
        user_id NVARCHAR(50) NOT NULL,
        name NVARCHAR(100) NOT NULL,
        title NVARCHAR(200) NOT NULL,
        description NVARCHAR(MAX) DEFAULT '',
        priority INT DEFAULT 1,
        category INT DEFAULT 0,
        repeat_type INT DEFAULT 0,
        sub_tasks NVARCHAR(MAX) DEFAULT '[]',
        tags NVARCHAR(MAX) DEFAULT '[]',
        created_at DATETIME2 DEFAULT GETDATE(),
        is_synced BIT DEFAULT 1,
        FOREIGN KEY (user_id) REFERENCES Users(id) ON DELETE CASCADE
      )
    `);

    await db.query(`
      IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='Notes' AND xtype='U')
      CREATE TABLE Notes (
        id NVARCHAR(50) PRIMARY KEY,
        user_id NVARCHAR(50) NOT NULL,
        title NVARCHAR(200) NOT NULL,
        content NVARCHAR(MAX) DEFAULT '',
        color INT DEFAULT 0,
        created_at DATETIME2 DEFAULT GETDATE(),
        updated_at DATETIME2 DEFAULT GETDATE(),
        is_synced BIT DEFAULT 1,
        FOREIGN KEY (user_id) REFERENCES Users(id) ON DELETE CASCADE
      )
    `);

    console.log('All tables ready!');
  } catch (err) {
    console.error('Table creation error:', err.message);
  }
}

function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token provided' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.userId = decoded.userId;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', database: dbReady ? 'connected' : 'disconnected' });
});

// Auth
app.post('/api/auth/signup', async (req, res) => {
  try {
    const { name, email, password } = req.body;
    console.log('Signup:', email);
    const db = await getPool();
    const existing = await db.request()
      .input('email', sql.NVarChar, email)
      .query('SELECT id FROM Users WHERE email = @email');
    if (existing.recordset.length > 0) {
      return res.status(400).json({ error: 'Email already exists' });
    }
    const id = 'user_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    const hashedPassword = await bcrypt.hash(password, 10);
    await db.request()
      .input('id', sql.NVarChar, id)
      .input('name', sql.NVarChar, name)
      .input('email', sql.NVarChar, email)
      .input('password', sql.NVarChar, hashedPassword)
      .query('INSERT INTO Users (id, name, email, password) VALUES (@id, @name, @email, @password)');
    const token = jwt.sign({ userId: id }, JWT_SECRET, { expiresIn: '30d' });
    console.log('Signup OK:', email);
    res.json({ token, user: { id, name, email } });
  } catch (err) {
    console.error('Signup error:', err.message);
    res.status(500).json({ error: 'Signup failed: ' + err.message });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const db = await getPool();
    const result = await db.request()
      .input('email', sql.NVarChar, email)
      .query('SELECT * FROM Users WHERE email = @email');
    if (result.recordset.length === 0) {
      return res.status(400).json({ error: 'Invalid credentials' });
    }
    const user = result.recordset[0];
    const valid = await bcrypt.compare(password, user.password);
    if (!valid) {
      return res.status(400).json({ error: 'Invalid credentials' });
    }
    const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ token, user: { id: user.id, name: user.name, email: user.email } });
  } catch (err) {
    console.error('Login error:', err.message);
    res.status(500).json({ error: 'Login failed' });
  }
});

app.get('/api/auth/me', authMiddleware, async (req, res) => {
  try {
    const db = await getPool();
    const result = await db.request()
      .input('id', sql.NVarChar, req.userId)
      .query('SELECT id, name, email, created_at FROM Users WHERE id = @id');
    if (result.recordset.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json({ user: result.recordset[0] });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.put('/api/auth/profile', authMiddleware, async (req, res) => {
  try {
    const { name, email } = req.body;
    const db = await getPool();
    if (email) {
      const existing = await db.request()
        .input('email', sql.NVarChar, email)
        .input('id', sql.NVarChar, req.userId)
        .query('SELECT id FROM Users WHERE email = @email AND id != @id');
      if (existing.recordset.length > 0) {
        return res.status(400).json({ error: 'Email already in use' });
      }
    }
    await db.request()
      .input('id', sql.NVarChar, req.userId)
      .input('name', sql.NVarChar, name)
      .input('email', sql.NVarChar, email)
      .query('UPDATE Users SET name = @name, email = @email WHERE id = @id');
    res.json({ user: { id: req.userId, name, email } });
  } catch (err) {
    console.error('Profile update error:', err.message);
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

app.put('/api/auth/password', authMiddleware, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const db = await getPool();
    const result = await db.request()
      .input('id', sql.NVarChar, req.userId)
      .query('SELECT password FROM Users WHERE id = @id');
    if (result.recordset.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    const valid = await bcrypt.compare(currentPassword, result.recordset[0].password);
    if (!valid) {
      return res.status(400).json({ error: 'Current password is incorrect' });
    }
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await db.request()
      .input('id', sql.NVarChar, req.userId)
      .input('password', sql.NVarChar, hashedPassword)
      .query('UPDATE Users SET password = @password WHERE id = @id');
    res.json({ success: true });
  } catch (err) {
    console.error('Password change error:', err.message);
    res.status(500).json({ error: 'Failed to change password' });
  }
});

// Todos
app.get('/api/todos', authMiddleware, async (req, res) => {
  try {
    const db = await getPool();
    const result = await db.request()
      .input('user_id', sql.NVarChar, req.userId)
      .query('SELECT * FROM Todos WHERE user_id = @user_id ORDER BY due_date DESC');
    const todos = result.recordset.map(t => ({
      ...t,
      is_completed: t.is_completed ? true : false,
      is_starred: t.is_starred ? true : false,
      sub_tasks: t.sub_tasks ? JSON.parse(t.sub_tasks) : [],
      tags: t.tags ? JSON.parse(t.tags) : []
    }));
    res.json({ todos });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/todos', authMiddleware, async (req, res) => {
  try {
    const db = await getPool();
    const t = req.body;
    await db.request()
      .input('id', sql.NVarChar, t.id)
      .input('user_id', sql.NVarChar, req.userId)
      .input('title', sql.NVarChar, t.title)
      .input('description', sql.NVarChar, t.description || '')
      .input('due_date', sql.DateTime2, t.dueDate)
      .input('created_at', sql.DateTime2, t.createdAt || new Date().toISOString())
      .input('priority', sql.Int, t.priority ?? 1)
      .input('category', sql.Int, t.category ?? 0)
      .input('is_completed', sql.Bit, t.isCompleted ?? false)
      .input('is_starred', sql.Bit, t.isStarred ?? false)
      .input('sub_tasks', sql.NVarChar, JSON.stringify(t.subTasks || []))
      .input('repeat_type', sql.Int, t.repeatType ?? 0)
      .input('reminder_time', sql.DateTime2, t.reminderTime || null)
      .input('tags', sql.NVarChar, JSON.stringify(t.tags || []))
      .query(`INSERT INTO Todos (id, user_id, title, description, due_date, created_at, priority, category, is_completed, is_starred, sub_tasks, repeat_type, reminder_time, tags, is_synced)
              VALUES (@id, @user_id, @title, @description, @due_date, @created_at, @priority, @category, @is_completed, @is_starred, @sub_tasks, @repeat_type, @reminder_time, @tags, 1)`);
    res.json({ success: true });
  } catch (err) {
    console.error('Create todo error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

app.put('/api/todos/:id', authMiddleware, async (req, res) => {
  try {
    const db = await getPool();
    const t = req.body;
    await db.request()
      .input('id', sql.NVarChar, req.params.id)
      .input('user_id', sql.NVarChar, req.userId)
      .input('title', sql.NVarChar, t.title)
      .input('description', sql.NVarChar, t.description || '')
      .input('due_date', sql.DateTime2, t.dueDate)
      .input('priority', sql.Int, t.priority ?? 1)
      .input('category', sql.Int, t.category ?? 0)
      .input('is_completed', sql.Bit, t.isCompleted ?? false)
      .input('is_starred', sql.Bit, t.isStarred ?? false)
      .input('sub_tasks', sql.NVarChar, JSON.stringify(t.subTasks || []))
      .input('repeat_type', sql.Int, t.repeatType ?? 0)
      .input('reminder_time', sql.DateTime2, t.reminderTime || null)
      .input('tags', sql.NVarChar, JSON.stringify(t.tags || []))
      .query(`UPDATE Todos SET title=@title, description=@description, due_date=@due_date, priority=@priority, category=@category,
              is_completed=@is_completed, is_starred=@is_starred, sub_tasks=@sub_tasks, repeat_type=@repeat_type, reminder_time=@reminder_time, tags=@tags, is_synced=1
              WHERE id=@id AND user_id=@user_id`);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.delete('/api/todos/:id', authMiddleware, async (req, res) => {
  try {
    const db = await getPool();
    await db.request()
      .input('id', sql.NVarChar, req.params.id)
      .input('user_id', sql.NVarChar, req.userId)
      .query('DELETE FROM Todos WHERE id=@id AND user_id=@user_id');
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Appointments
app.get('/api/appointments', authMiddleware, async (req, res) => {
  try {
    const db = await getPool();
    const result = await db.request()
      .input('user_id', sql.NVarChar, req.userId)
      .query('SELECT * FROM Appointments WHERE user_id = @user_id ORDER BY start_time DESC');
    res.json({ appointments: result.recordset });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/appointments', authMiddleware, async (req, res) => {
  try {
    const db = await getPool();
    const a = req.body;
    await db.request()
      .input('id', sql.NVarChar, a.id)
      .input('user_id', sql.NVarChar, req.userId)
      .input('title', sql.NVarChar, a.title)
      .input('description', sql.NVarChar, a.description || '')
      .input('start_time', sql.DateTime2, a.startTime)
      .input('end_time', sql.DateTime2, a.endTime)
      .input('location', sql.NVarChar, a.location || '')
      .input('type', sql.Int, a.type ?? 0)
      .input('status', sql.Int, a.status ?? 0)
      .input('contact_name', sql.NVarChar, a.contactName || '')
      .input('contact_phone', sql.NVarChar, a.contactPhone || '')
      .input('notes', sql.NVarChar, a.notes || '')
      .input('is_reminder_enabled', sql.Bit, a.isReminderEnabled ?? true)
      .input('created_at', sql.DateTime2, a.createdAt || new Date().toISOString())
      .query(`INSERT INTO Appointments (id, user_id, title, description, start_time, end_time, location, type, status, contact_name, contact_phone, notes, is_reminder_enabled, created_at, is_synced)
              VALUES (@id, @user_id, @title, @description, @start_time, @end_time, @location, @type, @status, @contact_name, @contact_phone, @notes, @is_reminder_enabled, @created_at, 1)`);
    res.json({ success: true });
  } catch (err) {
    console.error('Create appointment error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

app.put('/api/appointments/:id', authMiddleware, async (req, res) => {
  try {
    const db = await getPool();
    const a = req.body;
    await db.request()
      .input('id', sql.NVarChar, req.params.id)
      .input('user_id', sql.NVarChar, req.userId)
      .input('title', sql.NVarChar, a.title)
      .input('description', sql.NVarChar, a.description || '')
      .input('start_time', sql.DateTime2, a.startTime)
      .input('end_time', sql.DateTime2, a.endTime)
      .input('location', sql.NVarChar, a.location || '')
      .input('type', sql.Int, a.type ?? 0)
      .input('status', sql.Int, a.status ?? 0)
      .input('contact_name', sql.NVarChar, a.contactName || '')
      .input('contact_phone', sql.NVarChar, a.contactPhone || '')
      .input('notes', sql.NVarChar, a.notes || '')
      .input('is_reminder_enabled', sql.Bit, a.isReminderEnabled ?? true)
      .query(`UPDATE Appointments SET title=@title, description=@description, start_time=@start_time, end_time=@end_time, location=@location,
              type=@type, status=@status, contact_name=@contact_name, contact_phone=@contact_phone, notes=@notes, is_reminder_enabled=@is_reminder_enabled, is_synced=1
              WHERE id=@id AND user_id=@user_id`);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.delete('/api/appointments/:id', authMiddleware, async (req, res) => {
  try {
    const db = await getPool();
    await db.request()
      .input('id', sql.NVarChar, req.params.id)
      .input('user_id', sql.NVarChar, req.userId)
      .query('DELETE FROM Appointments WHERE id=@id AND user_id=@user_id');
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Templates
app.get('/api/templates', authMiddleware, async (req, res) => {
  try {
    const db = await getPool();
    const result = await db.request()
      .input('user_id', sql.NVarChar, req.userId)
      .query('SELECT * FROM Templates WHERE user_id = @user_id ORDER BY created_at DESC');
    const templates = result.recordset.map(t => ({
      ...t,
      sub_tasks: t.sub_tasks ? JSON.parse(t.sub_tasks) : [],
      tags: t.tags ? JSON.parse(t.tags) : []
    }));
    res.json({ templates });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/templates', authMiddleware, async (req, res) => {
  try {
    const db = await getPool();
    const t = req.body;
    await db.request()
      .input('id', sql.NVarChar, t.id)
      .input('user_id', sql.NVarChar, req.userId)
      .input('name', sql.NVarChar, t.name)
      .input('title', sql.NVarChar, t.title)
      .input('description', sql.NVarChar, t.description || '')
      .input('priority', sql.Int, t.priority ?? 1)
      .input('category', sql.Int, t.category ?? 0)
      .input('repeat_type', sql.Int, t.repeatType ?? 0)
      .input('sub_tasks', sql.NVarChar, JSON.stringify(t.subTasks || []))
      .input('tags', sql.NVarChar, JSON.stringify(t.tags || []))
      .input('created_at', sql.DateTime2, t.createdAt || new Date().toISOString())
      .query(`INSERT INTO Templates (id, user_id, name, title, description, priority, category, repeat_type, sub_tasks, tags, created_at, is_synced)
              VALUES (@id, @user_id, @name, @title, @description, @priority, @category, @repeat_type, @sub_tasks, @tags, @created_at, 1)`);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.delete('/api/templates/:id', authMiddleware, async (req, res) => {
  try {
    const db = await getPool();
    await db.request()
      .input('id', sql.NVarChar, req.params.id)
      .input('user_id', sql.NVarChar, req.userId)
      .query('DELETE FROM Templates WHERE id=@id AND user_id=@user_id');
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Sync
app.post('/api/sync', authMiddleware, async (req, res) => {
  try {
    const db = await getPool();
    const { todos, appointments, templates } = req.body;
    if (todos && todos.length > 0) {
      for (const t of todos) {
        await db.request()
          .input('id', sql.NVarChar, t.id)
          .input('user_id', sql.NVarChar, req.userId)
          .input('title', sql.NVarChar, t.title)
          .input('description', sql.NVarChar, t.description || '')
          .input('due_date', sql.DateTime2, t.dueDate)
          .input('created_at', sql.DateTime2, t.createdAt || new Date().toISOString())
          .input('priority', sql.Int, t.priority ?? 1)
          .input('category', sql.Int, t.category ?? 0)
          .input('is_completed', sql.Bit, t.isCompleted ?? false)
          .input('is_starred', sql.Bit, t.isStarred ?? false)
          .input('sub_tasks', sql.NVarChar, JSON.stringify(t.subTasks ?? []))
          .input('repeat_type', sql.Int, t.repeatType ?? 0)
          .input('reminder_time', sql.DateTime2, t.reminderTime)
          .input('tags', sql.NVarChar, JSON.stringify(t.tags ?? []))
          .query(`IF NOT EXISTS (SELECT 1 FROM Todos WHERE id=@id)
                  INSERT INTO Todos (id, user_id, title, description, due_date, created_at, priority, category, is_completed, is_starred, sub_tasks, repeat_type, reminder_time, tags, is_synced)
                  VALUES (@id, @user_id, @title, @description, @due_date, @created_at, @priority, @category, @is_completed, @is_starred, @sub_tasks, @repeat_type, @reminder_time, @tags, 1)
                  ELSE
                  UPDATE Todos SET title=@title, is_completed=@is_completed, is_starred=@is_starred, is_synced=1 WHERE id=@id`);
      }
    }
    res.json({ success: true });
  } catch (err) {
    console.error('Sync error:', err.message);
    res.status(500).json({ error: 'Sync failed' });
  }
});

const PORT = process.env.PORT || 3000;

// Start server and connect to DB in background
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
  // Connect to DB in background - don't block server startup
  getPool().catch(err => {
    console.error('DB will connect when available:', err.message);
  });
});
