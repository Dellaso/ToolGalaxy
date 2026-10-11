// 太阳系倒计时 - 页面逻辑
// 椭圆轨道：ry > rx，纵向更长，填满竖屏

const PLANETS_CONFIG = [
  { name: '水星',   key: 'mercury', duration: 60,    rx: 108, ry: 146, size: 16, initAngle: 0.0 },
  { name: '金星',   key: 'venus',   duration: 180,   rx: 146, ry: 197, size: 26, initAngle: 0.8 },
  { name: '地球',   key: 'earth',   duration: 300,   rx: 184, ry: 248, size: 28, initAngle: 1.6 },
  { name: '火星',   key: 'mars',    duration: 600,   rx: 220, ry: 297, size: 24, initAngle: 2.4 },
  { name: '木星',   key: 'jupiter', duration: 3000,  rx: 262, ry: 354, size: 48, initAngle: 3.2 },
  { name: '土星',   key: 'saturn',  duration: 7200,  rx: 298, ry: 402, size: 40, initAngle: 4.0 },
  { name: '天王星', key: 'uranus',  duration: 21600, rx: 330, ry: 446, size: 34, initAngle: 4.8 },
  { name: '海王星', key: 'neptune', duration: 36000, rx: 350, ry: 473, size: 32, initAngle: 5.6 },
];

const TWO_PI = 2 * Math.PI;

Page({
  data: {
    sunTimeText: '00:00:00',
    sunHintText: '点击开始',
    sunState: 'idle', // idle | running | paused
    soundOn: true,
    stars: [],
    planets: [],
  },

  onLoad() {
    const stars = [];
    for (let i = 0; i < 90; i++) {
      stars.push({
        x: (Math.random() * 750).toFixed(1),
        y: (Math.random() * 900).toFixed(1),
        size: (Math.random() * 3 + 1).toFixed(1),
        opacity: (Math.random() * 0.6 + 0.3).toFixed(2),
        delay: (Math.random() * 4).toFixed(2),
        twinkle: Math.random() > 0.45,
      });
    }

    // 行星三态：ready（待开始）| running（倒计时中）| paused（已暂停）
    const planets = PLANETS_CONFIG.map(p => {
      const angle = p.initAngle;
      return {
        ...p,
        state: 'ready',
        completed: false,
        anchorAngle: angle,   // 本次公转的起点角度
        currentAngle: angle,  // 当前/暂停时的角度
        runStartTime: 0,
        x: this.round1(p.rx * Math.cos(angle)),
        y: this.round1(p.ry * Math.sin(angle)),
        // 纯 CSS 进度弧参数
        scaleK: (p.ry / p.rx).toFixed(4),      // 圆→椭圆纵向压缩
        offsetDeg: this.angleToOffsetDeg(angle), // 弧起点对齐公起点
        deg1: -135,   // 右半环旋转角 -135~45（进度 0~50%）
        deg2: -135,   // 左半环旋转角 -135~45（进度 50~100%）
        displayText: this.formatTime(p.duration),
      };
    });

    // 读取静音偏好
    let soundOn = true;
    try {
      const saved = wx.getStorageSync('soundOn');
      if (saved === false || saved === 'false') soundOn = false;
    } catch (e) {}

    this.setData({ stars, planets, soundOn });
    this.runningSet = new Set();

    // 初始化提示音音频（真实本地资源）
    this.initAudio();
  },

  // 公转起点弧度 → CSS 弧环整体偏移角度（让进度弧从该点开始顺时针展开）
  // 进度弧从环内 12 点方向（屏幕角 270°）起扫，旋转 A+90° 后起点方向变为 A，
  // 与行星位置 (rx·cosA, ry·sinA) 严格同源；scaleY 压缩后落在椭圆轨道上
  angleToOffsetDeg(angle) {
    return Math.round((angle * 180 / Math.PI + 90) * 10) / 10;
  },

  // 进度 0~1 → 两个 180° 半弧的旋转角（-135° 时金弧完全藏在对面窗口，
  // 转到 45° 时金弧恰好铺满本侧窗口）
  progressToDeg(progress) {
    const p = Math.max(0, Math.min(progress, 1));
    return {
      deg1: Math.round((-135 + 360 * Math.min(p, 0.5)) * 10) / 10,      // 右半：0~50%
      deg2: Math.round((-135 + 360 * Math.max(p - 0.5, 0)) * 10) / 10,  // 左半：50~100%
    };
  },

  // ========== 音效 ==========
  initAudio() {
    // 音效开关试听音
    const audio = wx.createInnerAudioContext();
    audio.src = '/assets/sounds/ding.wav';
    audio.volume = 0.9;
    audio.onError((err) => {
      console.warn('提示音播放失败', err);
    });
    this.audio = audio;

    // 各行星专属音效（按行星下标缓存，按需创建、重置时销毁）
    this.boomAudios = {}; // 爆炸一次性音效
    this.burnAudios = {}; // 燃烧循环音
  },

  playDing() {
    if (!this.data.soundOn || !this.audio) return;
    try {
      this.audio.stop();
      this.audio.seek(0);
      this.audio.play();
    } catch (e) {
      console.warn('提示音异常', e);
    }
  },

  // 获取/创建某行星的爆炸音（每颗行星专属音频文件）
  getBoom(i) {
    if (!this.boomAudios[i]) {
      const boom = wx.createInnerAudioContext();
      boom.src = `/assets/sounds/explosion_${PLANETS_CONFIG[i].key}.wav`;
      boom.volume = 0.95;
      boom.onError((err) => {
        console.warn('爆炸音播放失败', err);
      });
      this.boomAudios[i] = boom;
    }
    return this.boomAudios[i];
  },

  // 获取/创建某行星的燃烧循环音（每颗行星专属音频文件）
  getBurn(i) {
    if (!this.burnAudios[i]) {
      const burn = wx.createInnerAudioContext();
      burn.src = `/assets/sounds/burn_${PLANETS_CONFIG[i].key}.wav`;
      burn.loop = true;
      burn.volume = 0.55;
      burn.onError((err) => {
        console.warn('燃烧音播放失败', err);
      });
      this.burnAudios[i] = burn;
    }
    return this.burnAudios[i];
  },

  // 爆炸音效 + 震动 + 启动该行星的持续燃烧循环音
  playExplosion(i) {
    try { wx.vibrateShort({ type: 'heavy' }); } catch (e) {}
    if (this.data.soundOn) {
      try {
        const boom = this.getBoom(i);
        boom.stop();
        boom.seek(0);
        boom.play();
      } catch (e) {
        console.warn('爆炸音异常', e);
      }
    }
    this.startBurn(i);
  },

  startBurn(i) {
    if (!this.data.soundOn || this.burnAudios[i]) return;
    this.getBurn(i).play();
  },

  // 重置行星时销毁其全部音效实例
  stopPlanetAudio(i) {
    ['boomAudios', 'burnAudios'].forEach(map => {
      if (this[map] && this[map][i]) {
        try {
          this[map][i].stop();
          this[map][i].destroy();
        } catch (e) {}
        delete this[map][i];
      }
    });
  },

  stopAllBurns() {
    if (!this.burnAudios) return;
    Object.keys(this.burnAudios).forEach(i => {
      if (this.burnAudios[i]) {
        try { this.burnAudios[i].stop(); } catch (e) {}
      }
    });
  },

  onSoundToggle() {
    const soundOn = !this.data.soundOn;
    this.setData({ soundOn });
    try { wx.setStorageSync('soundOn', soundOn); } catch (e) {}
    if (soundOn) {
      this.playDing(); // 打开时试听
      // 恢复所有正在燃烧的行星的循环音
      this.data.planets.forEach((p, idx) => {
        if (p.state === 'done') this.startBurn(idx);
      });
    } else {
      this.stopAllBurns();
    }
  },

  // ========== 太阳正计时（开始→暂停→清零）==========
  onSunTap() {
    const state = this.data.sunState;
    if (state === 'idle') {
      this.sunStartTime = Date.now();
      this.sunElapsed = 0;
      this.setData({ sunState: 'running', sunTimeText: '00:00:00', sunHintText: '点击暂停' });
      this.startSunTimer();
    } else if (state === 'running') {
      this.sunElapsed += Date.now() - this.sunStartTime;
      this.stopSunTimer();
      this.setData({ sunState: 'paused', sunHintText: '点击清零' });
    } else {
      this.stopSunTimer();
      this.sunElapsed = 0;
      this.setData({ sunState: 'idle', sunTimeText: '00:00:00', sunHintText: '点击开始' });
    }
  },

  startSunTimer() {
    if (this.sunTimer) return;
    this.sunTimer = setInterval(() => {
      const total = (this.sunElapsed + (Date.now() - this.sunStartTime)) / 1000;
      this.setData({ sunTimeText: this.formatTime(Math.floor(total)) });
    }, 500);
  },

  stopSunTimer() {
    if (this.sunTimer) { clearInterval(this.sunTimer); this.sunTimer = null; }
  },

  // ========== 行星倒计时（单击：开始 → 暂停 → 重置）==========
  onPlanetTap(e) {
    const i = e.currentTarget.dataset.index;
    const p = this.data.planets[i];
    if (!p) return;
    if (p.state === 'ready') this.startPlanet(i);
    else if (p.state === 'running') this.pausePlanet(i);
    else this.resetPlanet(i);
  },

  // 底部面板同样走三态循环
  onStatusTap(e) {
    this.onPlanetTap(e);
  },

  // 第一次单击：从 anchorAngle 开始完整倒计时
  startPlanet(i) {
    this.setData({
      [`planets[${i}].state`]: 'running',
      [`planets[${i}].completed`]: false,
      [`planets[${i}].runStartTime`]: Date.now(),
      [`planets[${i}].deg1`]: -135,
      [`planets[${i}].deg2`]: -135,
      [`planets[${i}].displayText`]: this.formatTime(this.data.planets[i].duration),
    });
    this.runningSet.add(i);
    this.startAnimLoop();
  },

  // 第二次单击：暂停，冻结当前位置与剩余时间
  pausePlanet(i) {
    const p = this.data.planets[i];
    const elapsed = (Date.now() - p.runStartTime) / 1000;
    const progress = Math.min(elapsed / p.duration, 1);
    const currentAngle = p.anchorAngle + progress * TWO_PI;
    const remaining = Math.max(p.duration - elapsed, 0);

    this.runningSet.delete(i);
    const deg = this.progressToDeg(progress);
    this.setData({
      [`planets[${i}].state`]: 'paused',
      [`planets[${i}].currentAngle`]: currentAngle,
      [`planets[${i}].x`]: this.round1(p.rx * Math.cos(currentAngle)),
      [`planets[${i}].y`]: this.round1(p.ry * Math.sin(currentAngle)),
      [`planets[${i}].deg1`]: deg.deg1,
      [`planets[${i}].deg2`]: deg.deg2,
      [`planets[${i}].displayText`]: this.formatTime(Math.ceil(remaining)),
    });
    if (this.runningSet.size === 0) this.stopAnimLoop();
  },

  // 第三次单击：重置为完整倒计时，以停止位置作为新的公转起点
  resetPlanet(i) {
    const p = this.data.planets[i];
    const newAnchor = p.currentAngle % TWO_PI; // 停在哪，就从哪开始下一圈
    this.stopPlanetAudio(i); // done 态重置时熄灭该行星全部音效
    this.setData({
      [`planets[${i}].state`]: 'ready',
      [`planets[${i}].anchorAngle`]: newAnchor,
      [`planets[${i}].currentAngle`]: newAnchor,
      [`planets[${i}].offsetDeg`]: this.angleToOffsetDeg(newAnchor),
      [`planets[${i}].deg1`]: -135,
      [`planets[${i}].deg2`]: -135,
      [`planets[${i}].displayText`]: this.formatTime(p.duration),
    });
  },

  startAnimLoop() {
    if (this.animTimer) return;
    this.animTimer = setInterval(() => this.updatePositions(), 50);
  },

  stopAnimLoop() {
    if (this.animTimer) { clearInterval(this.animTimer); this.animTimer = null; }
  },

  updatePositions() {
    const now = Date.now();
    const updates = {};
    const done = [];

    this.runningSet.forEach(i => {
      const p = this.data.planets[i];
      if (!p) return;
      const elapsed = (now - p.runStartTime) / 1000;
      const progress = elapsed / p.duration;

      if (progress >= 1) {
        // 倒计时结束，刚好转完一周，行星进入 done 态：爆炸并持续燃烧，
        // 直到用户点击重置（done 为不可逆状态，不自动复位）
        const endAngle = p.anchorAngle + TWO_PI;
        updates[`planets[${i}].state`] = 'done';
        updates[`planets[${i}].completed`] = true;
        updates[`planets[${i}].currentAngle`] = endAngle;
        updates[`planets[${i}].x`] = this.round1(p.rx * Math.cos(endAngle));
        updates[`planets[${i}].y`] = this.round1(p.ry * Math.sin(endAngle));
        updates[`planets[${i}].deg1`] = 45;
        updates[`planets[${i}].deg2`] = 45;
        updates[`planets[${i}].displayText`] = '燃烧中';
        done.push(i);
      } else {
        const angle = p.anchorAngle + progress * TWO_PI;
        updates[`planets[${i}].currentAngle`] = angle;
        updates[`planets[${i}].x`] = this.round1(p.rx * Math.cos(angle));
        updates[`planets[${i}].y`] = this.round1(p.ry * Math.sin(angle));
        const deg = this.progressToDeg(progress);
        if (deg.deg1 !== p.deg1) updates[`planets[${i}].deg1`] = deg.deg1;
        if (deg.deg2 !== p.deg2) updates[`planets[${i}].deg2`] = deg.deg2;
        const newDisplay = this.formatTime(Math.ceil(p.duration - elapsed));
        if (newDisplay !== p.displayText) {
          updates[`planets[${i}].displayText`] = newDisplay;
        }
      }
    });

    if (Object.keys(updates).length > 0) this.setData(updates);

    done.forEach(i => {
      this.runningSet.delete(i);
      this.playExplosion(i); // 爆炸音 + 持续燃烧循环音，直至用户点击重置
    });
    if (this.runningSet.size === 0) this.stopAnimLoop();
  },

  // ========== 工具 ==========
  round1(n) { return Math.round(n * 10) / 10; },

  formatTime(seconds) {
    seconds = Math.max(0, Math.floor(seconds));
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    const pad = n => String(n).padStart(2, '0');
    if (h > 0) return `${pad(h)}:${pad(m)}:${pad(s)}`;
    return `${pad(m)}:${pad(s)}`;
  },

  onUnload() {
    this.stopSunTimer();
    this.stopAnimLoop();
    this.stopAllBurns();
    Object.keys(this.boomAudios || {}).forEach(i => {
      try { this.boomAudios[i].destroy(); } catch (e) {}
    });
    if (this.audio) { this.audio.destroy(); this.audio = null; }
  },
});
