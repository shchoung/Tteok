require('dotenv').config();
const express = require('express');
const path = require('path');
const { pool, checkConnection } = require('./db/pool');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// ── 목 데이터 (DB 연결 실패 시 fallback) ────────────────────
const MOCK = [
  { id:'1', name:'밀도',        address:'서울 성동구 서울숲2길 32-14', lat:37.5445, lng:127.0374, level:5, level_name:'빵신',   representative_bread:'브리오슈 식빵', rating:4.9, review_count:312, level_score:96.2 },
  { id:'2', name:'몽상클레르',  address:'서울 서초구 방배중앙로 57',    lat:37.4813, lng:126.9966, level:5, level_name:'빵신',   representative_bread:'몽블랑',       rating:4.8, review_count:287, level_score:93.5 },
  { id:'3', name:'르빵',        address:'서울 마포구 와우산로29길 26',  lat:37.5538, lng:126.9227, level:4, level_name:'빵달인', representative_bread:'바게트',       rating:4.6, review_count:145, level_score:81.0 },
  { id:'4', name:'브레드림',    address:'서울 용산구 이태원로 177',     lat:37.5347, lng:126.9947, level:4, level_name:'빵달인', representative_bread:'크루아상',     rating:4.5, review_count:98,  level_score:78.3 },
  { id:'5', name:'동네빵네',    address:'서울 강남구 논현로 842',       lat:37.5172, lng:127.0391, level:3, level_name:'빵고수', representative_bread:'소금빵',       rating:4.3, review_count:54,  level_score:67.1 },
  { id:'6', name:'행복베이커리',address:'서울 광진구 능동로 120',       lat:37.5484, lng:127.0858, level:2, level_name:'빵순이', representative_bread:'앙버터',       rating:4.1, review_count:23,  level_score:52.4 },
  { id:'7', name:'새벽빵집',    address:'서울 은평구 통일로 684',       lat:37.6020, lng:126.9292, level:1, level_name:'빵린이', representative_bread:'식빵',         rating:3.8, review_count:7,   level_score:28.5 },
];

const LEVEL_NAME = { 1:'빵린이', 2:'빵순이', 3:'빵고수', 4:'빵달인', 5:'빵신' };
let useDB = false;

// ── 자동 마이그레이션 구문 목록 ─────────────────────────────
const MIGRATION_STEPS = [
  { label: 'PostGIS',              sql: `CREATE EXTENSION IF NOT EXISTS postgis` },
  { label: 'uuid-ossp',            sql: `CREATE EXTENSION IF NOT EXISTS "uuid-ossp"` },
  { label: 'bakeries 테이블',      sql: `
    CREATE TABLE IF NOT EXISTS bakeries (
      id                   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      kakao_id             VARCHAR(20) UNIQUE,
      name                 VARCHAR(100) NOT NULL,
      address              TEXT, phone VARCHAR(20), url TEXT,
      geom                 GEOMETRY(Point, 4326) NOT NULL,
      category             VARCHAR(100),
      source               VARCHAR(20) DEFAULT 'kakao',
      representative_bread VARCHAR(100), icon_url TEXT,
      level                SMALLINT DEFAULT 1 CHECK (level BETWEEN 1 AND 5),
      level_score          NUMERIC(5,2) DEFAULT 0,
      avg_rating           NUMERIC(3,2) DEFAULT 0,
      review_count         INTEGER DEFAULT 0,
      avg_daily_sales      INTEGER DEFAULT 0,
      crawled_at TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
    )` },
  { label: '공간 인덱스',   sql: `CREATE INDEX IF NOT EXISTS idx_bakeries_geom  ON bakeries USING GIST (geom)` },
  { label: 'level 인덱스',  sql: `CREATE INDEX IF NOT EXISTS idx_bakeries_level ON bakeries (level)` },
  { label: 'reviews 테이블', sql: `
    CREATE TABLE IF NOT EXISTS reviews (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      bakery_id UUID NOT NULL REFERENCES bakeries(id) ON DELETE CASCADE,
      user_id UUID, rating SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
      content TEXT, bread_name VARCHAR(100), created_at TIMESTAMPTZ DEFAULT NOW()
    )` },
  { label: 'sales_reports 테이블', sql: `
    CREATE TABLE IF NOT EXISTS sales_reports (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      bakery_id UUID NOT NULL REFERENCES bakeries(id) ON DELETE CASCADE,
      reported_at DATE NOT NULL DEFAULT CURRENT_DATE,
      daily_sales INTEGER NOT NULL CHECK (daily_sales >= 0),
      source VARCHAR(20) DEFAULT 'owner', created_at TIMESTAMPTZ DEFAULT NOW()
    )` },
  { label: 'crawl_logs 테이블', sql: `
    CREATE TABLE IF NOT EXISTS crawl_logs (
      id SERIAL PRIMARY KEY, source VARCHAR(20),
      total INTEGER DEFAULT 0, inserted INTEGER DEFAULT 0,
      updated INTEGER DEFAULT 0, skipped INTEGER DEFAULT 0,
      error TEXT, ran_at TIMESTAMPTZ DEFAULT NOW()
    )` },
  { label: '레벨 계산 함수', sql: `
    CREATE OR REPLACE FUNCTION calc_bakery_level(
      p_avg_rating NUMERIC, p_review_count INTEGER, p_avg_sales INTEGER
    ) RETURNS TABLE (level SMALLINT, score NUMERIC) AS $$
    DECLARE total_score NUMERIC;
    BEGIN
      total_score :=
        COALESCE(p_avg_rating,0)/5.0*40 +
        CASE WHEN p_review_count>=50 THEN 30 WHEN p_review_count>=20 THEN 22.5 WHEN p_review_count>=5 THEN 15 ELSE 0 END +
        CASE WHEN p_avg_sales>=200 THEN 30 WHEN p_avg_sales>=100 THEN 22.5 WHEN p_avg_sales>=30 THEN 15 ELSE 0 END;
      RETURN QUERY SELECT
        CASE WHEN total_score>=90 THEN 5 WHEN total_score>=75 THEN 4 WHEN total_score>=60 THEN 3 WHEN total_score>=40 THEN 2 ELSE 1 END::SMALLINT,
        ROUND(total_score,2);
    END; $$ LANGUAGE plpgsql` },
  { label: '레벨 트리거 함수', sql: `
    CREATE OR REPLACE FUNCTION refresh_bakery_level() RETURNS TRIGGER AS $$
    DECLARE stats RECORD; lvl RECORD;
    BEGIN
      SELECT AVG(r.rating)::NUMERIC(3,2) AS avg_rating, COUNT(r.id)::INTEGER AS review_count,
        COALESCE((SELECT AVG(daily_sales)::INTEGER FROM sales_reports
          WHERE bakery_id=NEW.bakery_id AND reported_at>=CURRENT_DATE-INTERVAL '30 days'),0) AS avg_sales
      INTO stats FROM reviews r WHERE r.bakery_id=NEW.bakery_id;
      SELECT * INTO lvl FROM calc_bakery_level(stats.avg_rating,stats.review_count,stats.avg_sales);
      UPDATE bakeries SET avg_rating=stats.avg_rating, review_count=stats.review_count,
        avg_daily_sales=stats.avg_sales, level=lvl.level, level_score=lvl.score, updated_at=NOW()
      WHERE id=NEW.bakery_id;
      RETURN NEW;
    END; $$ LANGUAGE plpgsql` },
  { label: '레벨 트리거', sql: `
    CREATE OR REPLACE TRIGGER trg_review_level
      AFTER INSERT OR UPDATE ON reviews
      FOR EACH ROW EXECUTE FUNCTION refresh_bakery_level()` },
];

async function autoMigrate() {
  console.log('📦 DB 스키마 확인/생성 중...');
  for (const step of MIGRATION_STEPS) {
    try {
      await pool.query(step.sql.trim());
      console.log('  ✅', step.label);
    } catch (err) {
      if (err.message.includes('already exists')) {
        console.log('  ⏭ ', step.label, '(이미 존재)');
      } else {
        throw new Error(step.label + ' 실패: ' + err.message);
      }
    }
  }
  console.log('✅ 스키마 준비 완료');
}

// ── 시작 시 DB 연결 + 자동 마이그레이션 ────────────────────
(async () => {
  if (!process.env.DATABASE_URL) {
    console.log('⚠️  DATABASE_URL 없음 → 목 데이터 모드');
    return;
  }
  try {
    const info = await checkConnection();
    console.log('✅ PostgreSQL 연결 성공');
    console.log('   서버 시각:', info.now);
    await autoMigrate();
    useDB = true;
    console.log('🍞 DB 모드로 서비스 시작');
  } catch (err) {
    console.warn('⚠️  DB 초기화 실패, 목 데이터로 fallback:', err.message);
  }
})();

// ── DB row → JSON 변환 ───────────────────────────────────────
function rowToJson(row) {
  return {
    id:                  row.id,
    name:                row.name,
    address:             row.address,
    lat:                 parseFloat(row.lat),
    lng:                 parseFloat(row.lng),
    level:               row.level,
    level_name:          LEVEL_NAME[row.level] || '빵린이',
    representative_bread: row.representative_bread || '시그니처 빵',
    rating:              parseFloat(row.avg_rating) || 0,
    review_count:        row.review_count || 0,
    level_score:         parseFloat(row.level_score) || 0,
    phone:               row.phone || null,
  };
}

// ── API: 빵집 목록 ───────────────────────────────────────────
app.get('/api/bakeries', async (req, res) => {
  const { level, minScore, lat, lng, radius = 5000 } = req.query;

  if (!useDB) {
    let data = [...MOCK];
    if (level)    data = data.filter(b => b.level === parseInt(level));
    if (minScore) data = data.filter(b => b.level_score >= parseFloat(minScore));
    return res.json({ success: true, count: data.length, source: 'mock', data });
  }

  try {
    let queryStr, params;

    if (lat && lng) {
      // 현재 위치 기반 반경 검색
      const extras = [];
      if (level)    extras.push(`AND level = $4`);
      if (minScore) extras.push(`AND level_score >= $${4 + (level ? 1 : 0)}`);

      queryStr = `
        SELECT *,
          ST_X(geom) AS lng, ST_Y(geom) AS lat,
          ST_Distance(geom::geography, ST_MakePoint($1,$2)::geography) AS distance
        FROM bakeries
        WHERE ST_DWithin(geom::geography, ST_MakePoint($1,$2)::geography, $3)
          ${extras.join(' ')}
        ORDER BY distance ASC
        LIMIT 200
      `;
      params = [parseFloat(lng), parseFloat(lat), parseFloat(radius),
                ...(level ? [parseInt(level)] : []),
                ...(minScore ? [parseFloat(minScore)] : [])];
    } else {
      const conditions = [];
      params = [];
      if (level)    { params.push(parseInt(level));        conditions.push(`level = $${params.length}`); }
      if (minScore) { params.push(parseFloat(minScore));   conditions.push(`level_score >= $${params.length}`); }

      queryStr = `
        SELECT *, ST_X(geom) AS lng, ST_Y(geom) AS lat
        FROM bakeries
        ${conditions.length ? 'WHERE ' + conditions.join(' AND ') : ''}
        ORDER BY level_score DESC
        LIMIT 500
      `;
    }

    const { rows } = await pool.query(queryStr, params);
    res.json({ success: true, count: rows.length, source: 'db', data: rows.map(rowToJson) });
  } catch (err) {
    console.error('bakeries 조회 오류:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── API: 빵집 단건 ───────────────────────────────────────────
app.get('/api/bakeries/:id', async (req, res) => {
  if (!useDB) {
    const b = MOCK.find(b => b.id === req.params.id);
    return b ? res.json({ success: true, data: b }) : res.status(404).json({ success: false });
  }
  try {
    const { rows } = await pool.query(
      `SELECT *, ST_X(geom) AS lng, ST_Y(geom) AS lat FROM bakeries WHERE id = $1`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ success: false, message: '빵집을 찾을 수 없어요' });
    res.json({ success: true, data: rowToJson(rows[0]) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── API: 후기 등록 ───────────────────────────────────────────
app.post('/api/bakeries/:id/reviews', async (req, res) => {
  if (!useDB) return res.status(503).json({ success: false, message: 'DB 미연결 상태' });

  const { rating, content, bread_name } = req.body;
  if (!rating || rating < 1 || rating > 5)
    return res.status(400).json({ success: false, message: '별점은 1~5 사이여야 해요' });

  try {
    const { rows } = await pool.query(
      `INSERT INTO reviews (bakery_id, rating, content, bread_name)
       VALUES ($1, $2, $3, $4)
       RETURNING id, rating, content, bread_name, created_at`,
      [req.params.id, rating, content || null, bread_name || null]
    );
    // trg_review_level 트리거가 자동으로 bakeries.level 재계산
    res.status(201).json({ success: true, data: rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── API: 후기 목록 ───────────────────────────────────────────
app.get('/api/bakeries/:id/reviews', async (req, res) => {
  if (!useDB) return res.json({ success: true, data: [] });
  try {
    const { rows } = await pool.query(
      `SELECT id, rating, content, bread_name, created_at
       FROM reviews WHERE bakery_id = $1
       ORDER BY created_at DESC LIMIT 50`,
      [req.params.id]
    );
    res.json({ success: true, count: rows.length, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── 헬스체크 ─────────────────────────────────────────────────
app.get('/health', async (req, res) => {
  const status = { service: '빵친자', mode: useDB ? 'db' : 'mock', timestamp: new Date().toISOString() };
  if (useDB) {
    try { await pool.query('SELECT 1'); status.db = 'connected'; }
    catch { status.db = 'error'; }
  }
  res.json(status);
});

app.listen(PORT, () => {
  console.log(`🍞 빵친자 서버 실행 중 → http://localhost:${PORT}`);
});
