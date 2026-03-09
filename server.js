const express = require('express');
const cors = require('cors');
const path = require('path');
const Anthropic = require('@anthropic-ai/sdk');

const app = express();
const PORT = process.env.PORT || 3000;

// ─────────────────────────────────────────────
// Claude AI 初始化（需环境变量 ANTHROPIC_API_KEY）
// 获取 Key：https://console.anthropic.com
// ─────────────────────────────────────────────
const anthropic = process.env.ANTHROPIC_API_KEY
    ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    : null;

if (anthropic) {
    console.log('✅ Claude AI 已启用 (claude-haiku-4-5)');
} else {
    console.log('⚠️  未设置 ANTHROPIC_API_KEY，将使用纯规则引擎模式');
}

app.use(cors());
app.use(express.json({ limit: '50kb' }));
app.use(express.static('public'));

// ─────────────────────────────────────────────
// Platform metadata
// ─────────────────────────────────────────────
const PLATFORMS = {
    xhs:      { name: '小红书',   icon: '📕', charLimits: { title: 20, contentMin: 150, contentMax: 1000 } },
    twitter:  { name: 'Twitter/X', icon: '🐦', charLimits: { title: 0,  contentMin: 30,  contentMax: 280  } },
    facebook: { name: 'Facebook',  icon: '📘', charLimits: { title: 0,  contentMin: 40,  contentMax: 63206 } }
};

// ─────────────────────────────────────────────
// Violation rules
// ─────────────────────────────────────────────
const PLATFORM_RULES = {
    xhs: {
        name: '小红书', icon: '📕',
        critical: {
            name: '严重违规（封号风险）', color: '#FF3B30',
            keywords: ['crypto','cryptocurrency','比特币','以太坊','炒币','币圈','交易所','binance','币安','欧易','okx','合约','杠杆','挖矿','矿机','空投','airdrop','ico','私募','区块链投资','defi','nft','钱包私钥','助记词','资金盘','传销','拉人头','返利','刷单','博彩','赌球','赌博','六合彩','捕鱼游戏','代理','加盟','躺赚','日入过万','月入十万','财富自由','被动收入','空手套']
        },
        high: {
            name: '高风险（引流导流）', color: '#FF9500',
            keywords: ['微信','VX','vx','V信','wechat','qq','QQ','二维码','加群','进群','私信','私聊','加我','联系我','WX','威信','微❤','V.X','微信同号','扫码','telegram','tg','whatsapp','私域','引流','后台发我','评论发我','滴我','找我']
        },
        medium: {
            name: '中风险（互动诱导）', color: '#FFCC00',
            keywords: ['点赞','收藏','关注','评论','转发','求赞','互粉','互赞','回关','关注有礼','关注送','私信领取','评论区留言','求关注','一键三连','双击','点个赞','帮忙关注','互相关注']
        },
        low: {
            name: '低风险（夸大宣传）', color: '#34C759',
            keywords: ['最便宜','绝对有效','百分百','100%','假一罚十','全网最低','史上最低价','错过等一年','全场最低','保证效果','无效退款','疗效','治愈','根治','完全治好']
        }
    },
    twitter: {
        name: 'Twitter/X', icon: '🐦',
        critical: {
            name: 'Policy Violation', color: '#FF3B30',
            keywords: ['hate speech','racial slur','terrorism','terrorist','child abuse','csam','self-harm','suicide method','buy followers','fake engagement','buy retweets','bot followers','mass report','doxxing','swatting']
        },
        high: {
            name: 'High Risk', color: '#FF9500',
            keywords: ['spam','mass dm','follow/unfollow','aggressive following','manipulation','ban evasion','fake account','coordinated inauthentic','astroturfing','brigading','harassment campaign']
        },
        medium: {
            name: 'Engagement Bait', color: '#FFCC00',
            keywords: ['please retweet','rt for rt','follow back','follow for follow','f4f','like for like','l4l','retweet if you agree','like if you agree','rt to win','follow to enter','giveaway requires follow']
        },
        low: {
            name: 'Minor Concern', color: '#34C759',
            keywords: ['check bio','link in bio','dm me','message me','check my profile','visit profile']
        }
    },
    facebook: {
        name: 'Facebook', icon: '📘',
        critical: {
            name: 'Community Standard Violation', color: '#FF3B30',
            keywords: ['hate speech','discrimination','violence','terrorism','fake news','misinformation','election interference','voter suppression','covid cure','vaccine causes','conspiracy theory','deepfake','identity theft']
        },
        high: {
            name: 'Reduced Distribution Risk', color: '#FF9500',
            keywords: ['clickbait','you won\'t believe','shocking truth','they don\'t want you to know','secret they hide','banned video','share to win','comment to enter','like and share to win','tag your friends to win']
        },
        medium: {
            name: 'Engagement Bait', color: '#FFCC00',
            keywords: ['like this post','share if you agree','tag someone who','type yes if','like for good luck','share for blessings','1 like =','ignore if you don\'t care']
        },
        low: {
            name: 'Minor Concern', color: '#34C759',
            keywords: ['click the link','swipe up','limited time','act now','hurry','last chance','don\'t miss out','buy now','shop now']
        }
    }
};

// ─────────────────────────────────────────────
// Content type detection
// ─────────────────────────────────────────────
const CONTENT_TYPES = {
    product_review: { label: '产品测评', labelEn: 'Product Review', icon: '⭐' },
    tutorial:       { label: '教程攻略', labelEn: 'Tutorial/How-to', icon: '📚' },
    lifestyle:      { label: '生活分享', labelEn: 'Lifestyle',       icon: '🌿' },
    promotion:      { label: '促销推广', labelEn: 'Promotion',       icon: '🏷️' },
    opinion:        { label: '观点评论', labelEn: 'Opinion/Hot Take', icon: '💬' },
    news:           { label: '资讯新闻', labelEn: 'News/Update',     icon: '📰' },
    entertainment:  { label: '娱乐搞笑', labelEn: 'Entertainment',   icon: '😄' }
};

function detectContentType(title, content) {
    const full = (title + ' ' + content).toLowerCase();
    const s = { product_review: 0, tutorial: 0, lifestyle: 0, promotion: 0, opinion: 0, news: 0, entertainment: 0 };

    if (/测评|开箱|体验|好用|推荐|安利|种草|踩雷|翻车|亲测|入手|值不值|worth it|review|unboxing|honest|first impression/.test(full)) s.product_review += 3;
    if (/教程|攻略|方法|技巧|步骤|如何|怎么|手把手|教学|干货|秘诀|how to|tutorial|guide|step by step|tips|tricks/.test(full)) s.tutorial += 3;
    if (/日记|记录|分享|日常|vlog|随记|心情|my day|daily|life|routine|journey/.test(full)) s.lifestyle += 3;
    if (/折扣|优惠|打折|促销|秒杀|特价|清仓|限时|满减|券|sale|discount|off|deal|promo|free/.test(full)) s.promotion += 3;
    if (/为什么|觉得|认为|看法|观点|思考|分析|评价|吐槽|think|opinion|take|believe|unpopular|hot take|imo/.test(full)) s.opinion += 3;
    if (/最新|今日|消息|通知|公告|报道|发布|上市|官宣|breaking|news|just in|update|happening|announced/.test(full)) s.news += 3;
    if (/搞笑|哈哈|笑死|梗|玩梗|段子|好笑|离谱|lol|funny|hilarious|meme/.test(full)) s.entertainment += 3;

    return Object.entries(s).sort((a, b) => b[1] - a[1])[0][0];
}

// ─────────────────────────────────────────────
// Content structure analysis
// ─────────────────────────────────────────────
function analyzeStructure(title, content, platform) {
    const full = title + ' ' + content;
    const fullLower = full.toLowerCase();

    const hookPatterns = {
        xhs: ['震惊','必看','绝了','救命','超绝','宝藏','强烈推荐','姐妹','omg','谁懂','我的天','太好了','神了','绝绝子','离谱','沉浸式','亲测','真的吗','天呐','哇塞'],
        twitter: ['thread','unpopular opinion','hot take','nobody talks about','reminder that','controversial','let\'s talk about','real talk','this is your sign','psa','hear me out','i need to talk about','nobody asked but'],
        facebook: ['this is important','true story','i never thought','something happened','just found out','worth sharing','my honest','this changed','i almost']
    };
    const hasHook = (hookPatterns[platform] || []).some(h => fullLower.includes(h));

    const hashtags = (content.match(/#[\w\u4e00-\u9fff]+/g) || []);
    const hashtagCount = hashtags.length;

    const ctaPatterns = {
        xhs: ['关注','收藏','点赞','分享','评论','留言','来聊','告诉我','你呢','大家','姐妹们','觉得有用'],
        twitter: ['follow','reply','quote','what do you think','thoughts','agree','disagree','tag','let me know','drop'],
        facebook: ['share','comment','what do you think','have you','tag a friend','let me know','your thoughts']
    };
    const hasCTA = (ctaPatterns[platform] || []).some(p => fullLower.includes(p));

    const emojiCount = (full.match(/[\u{1F300}-\u{1FFFF}]|[\u{2600}-\u{26FF}]/gu) || []).length;
    const paragraphs = content.split('\n').filter(p => p.trim().length > 0).length;
    const hasQuestion = /[？?]/.test(content);
    const titleHasNumber = /\d+/.test(title);
    const contentHasNumber = /\d+/.test(content);

    return { hasHook, hashtagCount, hashtags: hashtags.map(h => h), hasCTA, emojiCount, paragraphs, hasQuestion, titleHasNumber, contentHasNumber };
}

// ─────────────────────────────────────────────
// Violation check (with keyword deduplication)
// ─────────────────────────────────────────────
function checkViolations(title, content, platform) {
    const rules = PLATFORM_RULES[platform];
    const violations = [];
    const seen = new Set();
    let complianceScore = 100;
    const fullText = (title + ' ' + content).toLowerCase();

    Object.entries(rules).forEach(([level, rule]) => {
        if (level === 'name' || level === 'icon') return;
        rule.keywords.forEach(keyword => {
            const kl = keyword.toLowerCase();
            if (fullText.includes(kl) && !seen.has(kl)) {
                seen.add(kl);
                violations.push({ level, name: rule.name, keyword, color: rule.color });
                complianceScore -= (level === 'critical' ? 50 : level === 'high' ? 25 : level === 'medium' ? 15 : 8);
            }
        });
    });

    return { violations, complianceScore: Math.max(0, complianceScore) };
}

// ─────────────────────────────────────────────
// Enhanced scoring
// ─────────────────────────────────────────────
function calculateEngagement(title, content, platform, structure) {
    let score = 55;

    if (platform === 'xhs') {
        if (title.length >= 10 && title.length <= 20) score += 12;
        else if (title.length > 0 && title.length < 10) score += 4;
        if (structure.titleHasNumber) score += 6;
        if (structure.hasHook) score += 10;
        if (structure.hasCTA) score += 8;
        if (structure.hashtagCount >= 3 && structure.hashtagCount <= 8) score += 8;
        else if (structure.hashtagCount >= 1) score += 3;
        if (content.length >= 150 && content.length <= 500) score += 8;
        if (structure.emojiCount >= 2 && structure.emojiCount <= 10) score += 5;
        if (structure.paragraphs >= 3) score += 5;
        if (structure.hasQuestion) score += 4;
    } else if (platform === 'twitter') {
        if (content.length >= 100 && content.length <= 250) score += 12;
        if (structure.hasHook) score += 12;
        if (structure.hasCTA) score += 6;
        if (structure.hashtagCount >= 1 && structure.hashtagCount <= 2) score += 6;
        if (structure.hasQuestion) score += 10;
        if (structure.contentHasNumber) score += 5;
        if (content.includes('\n')) score += 5;
    } else if (platform === 'facebook') {
        if (content.length >= 40 && content.length <= 80) score += 14;
        else if (content.length > 80 && content.length <= 250) score += 7;
        if (structure.hasHook) score += 8;
        if (structure.hasCTA) score += 8;
        if (structure.hasQuestion) score += 12;
        if (structure.paragraphs >= 2) score += 5;
        if (structure.emojiCount >= 1 && structure.emojiCount <= 5) score += 4;
    }

    return Math.min(100, score);
}

function calculateViral(title, content, platform, structure, contentType) {
    let score = 35;
    const full = (title + ' ' + content).toLowerCase();

    if (structure.hasHook) score += 14;
    if (structure.titleHasNumber) score += 8;
    if (structure.hasQuestion) score += 6;
    if (structure.emojiCount >= 1) score += 4;

    const hooks = {
        xhs: ['震惊','揭秘','必看','绝了','救命','亲测','真实','宝藏','神仙','平替','超绝','绝绝子','沉浸式','种草'],
        twitter: ['thread','unpopular opinion','hot take','nobody talks about','this is wild','breaking','honest review','real talk','psa','plot twist'],
        facebook: ['true story','must read','this changed','life changing','honest','you need to know','important','worth reading']
    };
    (hooks[platform] || []).forEach(h => { if (full.includes(h)) score += 7; });

    const multipliers = { product_review: 1.1, tutorial: 1.15, opinion: 1.2, entertainment: 1.2, lifestyle: 1.0, promotion: 0.9, news: 1.05 };
    score *= (multipliers[contentType] || 1.0);

    if (full.length > 300) score += 5;
    if (platform === 'twitter' && content.includes('\n\n')) score += 8;

    return Math.min(100, Math.round(score));
}

function calculateReadability(content, platform) {
    let score = 55;

    const paragraphs = content.split('\n').filter(p => p.trim());
    if (paragraphs.length >= 4) score += 15;
    else if (paragraphs.length >= 2) score += 8;

    const avgParaLen = content.length / Math.max(paragraphs.length, 1);
    if (avgParaLen <= 80) score += 12;
    else if (avgParaLen <= 150) score += 6;
    else if (avgParaLen > 300) score -= 10;

    const sentences = content.split(/[。！？.!?]/).filter(s => s.trim());
    if (sentences.length >= 4) score += 8;

    if (/[\u{1F300}-\u{1FFFF}]/gu.test(content)) score += 5;

    return Math.min(100, Math.max(0, score));
}

// ─────────────────────────────────────────────
// Hashtag suggestions
// ─────────────────────────────────────────────
const HASHTAG_SUGGESTIONS = {
    xhs: {
        product_review: ['#好物推荐', '#亲测好用', '#产品测评', '#种草', '#真实测评', '#购物分享', '#好物清单'],
        tutorial:       ['#干货分享', '#学习笔记', '#实用技巧', '#新手必看', '#手把手教学', '#攻略', '#教程'],
        lifestyle:      ['#日常分享', '#生活记录', '#生活方式', '#日记', '#生活美学', '#vlog'],
        promotion:      ['#优惠推荐', '#好物', '#值得买', '#限时优惠', '#折扣'],
        opinion:        ['#聊聊', '#真实想法', '#观点分享', '#想说的话'],
        news:           ['#最新资讯', '#热点', '#新闻'],
        entertainment:  ['#搞笑', '#日常', '#有意思', '#好玩']
    },
    twitter: {
        product_review: ['#Review', '#HonestReview', '#ProductReview', '#Worth', '#Recommendation'],
        tutorial:       ['#HowTo', '#Tips', '#Tutorial', '#LearnOnTwitter', '#Guide'],
        lifestyle:      ['#Lifestyle', '#DailyLife', '#Routine'],
        promotion:      ['#Sale', '#Deal', '#Discount'],
        opinion:        ['#Opinion', '#Thoughts', '#HotTake', '#Discussion'],
        news:           ['#Breaking', '#News', '#Update'],
        entertainment:  ['#Funny', '#Memes', '#Entertainment']
    },
    facebook: {
        product_review: ['#Review', '#Recommendation', '#HonestOpinion', '#ProductReview'],
        tutorial:       ['#HowTo', '#Tips', '#Tutorial', '#LifeHacks'],
        lifestyle:      ['#Lifestyle', '#DailyLife', '#LifeUpdate'],
        promotion:      ['#Sale', '#Deals', '#Savings'],
        opinion:        ['#Opinion', '#Discussion', '#Thoughts'],
        news:           ['#News', '#Update', '#Trending'],
        entertainment:  ['#Funny', '#Entertainment', '#Humor']
    }
};

function suggestHashtags(contentType, platform, content) {
    const base = HASHTAG_SUGGESTIONS[platform]?.[contentType] || [];
    const existing = new Set((content.match(/#[\w\u4e00-\u9fff]+/g) || []).map(h => h.toLowerCase()));
    return base.filter(h => !existing.has(h.toLowerCase())).slice(0, 6);
}

// ─────────────────────────────────────────────
// Viral formulas library (research-based patterns)
// ─────────────────────────────────────────────
const VIRAL_FORMULAS = {
    xhs: [
        { formula: '[数字] + [动作] + [惊喜结果]', example: '用了30天，皮肤真的白了！', why: '数字增加可信度，结果制造期待' },
        { formula: '[情绪词] + [核心卖点/发现]', example: '救命！这个5块钱的东西真的太好用了', why: '强情绪开场，平价反差制造惊喜感' },
        { formula: '[平替/对比] + [省钱逻辑]', example: '花50块替代500块效果，省下的钱买奶茶🧋', why: '消费降级心理共鸣，转发率高' },
        { formula: '[问题] + [我的解决方案]', example: '熬夜长痘反复？这个步骤救了我的脸', why: '精准戳中痛点，收藏率高' },
        { formula: '[身份认同] + [专属攻略]', example: '打工人早餐攻略，5分钟营养不将就', why: '身份代入感强，目标人群精准' }
    ],
    twitter: [
        { formula: 'Hot take: [Controversial but defensible statement]', example: 'Hot take: Most productivity advice is for people who were already productive.', why: 'Sparks debate, drives quote tweets and replies' },
        { formula: '[Number] things nobody tells you about [relatable topic]', example: '7 things nobody tells you about freelancing in year 1', why: 'List format + insider knowledge = high saves/bookmarks' },
        { formula: 'Thread 🧵: [Compelling Hook that stops the scroll]', example: 'Thread: How I went from $0 to $10k/mo. Not a guru. Just what worked. 🧵', why: 'Thread format gets 3-5x engagement of single tweets' },
        { formula: 'In [X] years of [doing Y], I\'ve learned: [Insight]', example: 'In 5 years building startups, I learned: Ship before you\'re ready.', why: 'Experience signal builds credibility, invites discussion' },
        { formula: 'PSA: [Widely believed thing] is [actually wrong/different]', example: 'PSA: "Follow your passion" is bad career advice. Here\'s what actually works:', why: 'Challenges assumptions, triggers emotional response' }
    ],
    facebook: [
        { formula: 'Personal story + Universal lesson (3-5 sentences)', example: 'I almost quit my job last year. One conversation changed everything. Here\'s what I learned about asking for what you want.', why: 'Personal = authentic, lesson = shareable value' },
        { formula: 'Surprising question that makes people reflect', example: 'Why do we spend 40 hours a week on our career but almost none on figuring out what we actually want?', why: 'Questions generate 100%+ more comments than statements' },
        { formula: '[Time ago] vs [Now] transformation', example: 'This time last year: Anxious, overworked, unfulfilled. Today: Same job, different mindset. What changed?', why: 'Contrast structure triggers curiosity, story completion bias' },
        { formula: 'Myth-busting with data/experience', example: 'Drinking 8 glasses of water daily? The actual research says something different.', why: 'Challenges common knowledge, drives shares and comments' },
        { formula: '[Number] tools/tips + personal proof', example: '5 free tools that saved me 3 hours last week. (I wish someone had told me about these sooner)', why: 'Specific + useful + personal proof = high save and share rate' }
    ]
};

// ─────────────────────────────────────────────
// Optimization suggestions
// ─────────────────────────────────────────────
function generateOptimizations(title, content, platform, violations, structure, contentType) {
    const suggestions = [];

    // Critical violations first
    const critical = violations.filter(v => v.level === 'critical');
    if (critical.length > 0) {
        suggestions.push({
            priority: 'critical',
            category: platform === 'xhs' ? '合规' : 'Compliance',
            issue: platform === 'xhs' ? `${critical.length} 个严重违规词，发布将被屏蔽` : `${critical.length} critical violation(s) — post will be removed`,
            action: platform === 'xhs' ? '必须删除或替换以下词汇' : 'Must remove or replace these terms before publishing',
            example: critical.map(v => `"${v.keyword}"`).join('  ')
        });
    }

    if (platform === 'xhs') {
        if (!title) {
            suggestions.push({ priority: 'high', category: '标题', issue: '未填写标题', action: '小红书标题是搜索流量入口，建议 10-20 字，含核心关键词 + 情绪词', example: '"亲测！这个方法真的让我改变了..."' });
        } else if (title.length < 10) {
            suggestions.push({ priority: 'high', category: '标题', issue: `标题过短（${title.length} 字）`, action: '拉长至 10-20 字，加情绪词或数字提升点击率', example: `"【亲测】${title}，效果真的超出我预期！"` });
        } else if (title.length > 20) {
            suggestions.push({ priority: 'medium', category: '标题', issue: `标题偏长（${title.length} 字）`, action: '精简至 20 字内，保留：情绪词 + 核心词 + 结果', example: '删除"的、了、啊"等语气词，浓缩表达' });
        }

        if (!structure.hasHook) {
            suggestions.push({ priority: 'high', category: '钩子词', issue: '缺少情绪钩子', action: '标题/开头加钩子词可大幅提升点击率（研究显示提升 30-80%）', example: '震惊🔥 / 救命！/ 宝藏发现 / 姐妹必看 / 绝绝子' });
        }

        if (!structure.titleHasNumber) {
            suggestions.push({ priority: 'medium', category: '标题数字', issue: '标题无具体数字', action: '数字让标题更具体可信，显著提升点击欲望', example: '"用了7天" / "省了300块" / "3步搞定" / "第8天打卡"' });
        }

        if (content.length < 150) {
            suggestions.push({ priority: 'high', category: '内容长度', issue: `正文过短（${content.length} 字）`, action: '小红书算法重视读完率，建议 150-500 字完整描述体验', example: '补充：使用感受 → 适合人群 → 具体效果 → 搭配建议 → 避坑提醒' });
        } else if (content.length > 800) {
            suggestions.push({ priority: 'low', category: '内容长度', issue: `正文较长（${content.length} 字）`, action: '超过 800 字读完率明显下降，建议保留精华部分' });
        }

        if (structure.hashtagCount < 3) {
            suggestions.push({ priority: 'high', category: '话题标签', issue: `标签不足（${structure.hashtagCount} 个）`, action: '建议 5-8 个：1个大流量词 + 3个精准词 + 1个地域词', example: '#护肤 #平价好物 #学生党必看 #护肤心得 #上海好物' });
        } else if (structure.hashtagCount > 10) {
            suggestions.push({ priority: 'medium', category: '话题标签', issue: `标签过多（${structure.hashtagCount} 个）`, action: '超过 10 个标签可能被判定为刷流量，建议控制在 5-8 个' });
        }

        if (!structure.hasCTA) {
            suggestions.push({ priority: 'medium', category: '互动引导', issue: '缺少互动引导', action: '结尾加互动引导可提升评论量，算法奖励高评论内容', example: '"姐妹们有没有同款推荐？👇" / "你们平时怎么做的，评论聊聊～"' });
        }

        if (!structure.hasQuestion) {
            suggestions.push({ priority: 'low', category: '互动性', issue: '无提问', action: '加一个问题能有效增加评论数量', example: '"你们遇到过这个问题吗？" / "有更好的推荐吗？"' });
        }

        if (structure.emojiCount === 0) {
            suggestions.push({ priority: 'low', category: 'Emoji', issue: '未使用 Emoji', action: 'Emoji 增加可读性和情绪传递，每段 1-2 个为宜', example: '✨🔥💡🌿⭐💕 用于段落开头或关键词旁' });
        }

    } else if (platform === 'twitter') {
        if (content.length > 280) {
            suggestions.push({ priority: 'critical', category: 'Character Limit', issue: `Exceeds 280 chars (${content.length})`, action: 'Cannot be published. Split into a Thread (tweet 1/n) or shorten.', example: 'End tweet 1 with a hook, then continue as reply thread' });
        } else if (content.length < 60) {
            suggestions.push({ priority: 'medium', category: 'Content Depth', issue: `Too short (${content.length} chars)`, action: '60-250 char tweets get highest engagement. Add more context.', example: 'Add a specific data point, personal angle, or follow-up question' });
        }

        if (!structure.hasHook) {
            suggestions.push({ priority: 'high', category: 'Opening Hook', issue: 'Weak opening line', action: 'First 10 words determine if users expand. Lead with your strongest point.', example: '"Hot take: / Thread: / Unpopular opinion: / Nobody talks about..."' });
        }

        if (structure.hashtagCount > 2) {
            suggestions.push({ priority: 'high', category: 'Hashtags', issue: `Too many hashtags (${structure.hashtagCount})`, action: 'Twitter data shows 1-2 hashtags = peak engagement. More = lower reach.', example: 'Keep only the most relevant 1-2 topic hashtags' });
        } else if (structure.hashtagCount === 0) {
            suggestions.push({ priority: 'low', category: 'Hashtags', issue: 'No hashtags', action: 'Add 1-2 relevant hashtags to increase discoverability' });
        }

        if (!structure.hasQuestion) {
            suggestions.push({ priority: 'medium', category: 'Engagement', issue: 'No question', action: 'Ending with a question drives 3x more replies vs statement tweets', example: '"What do you think?" / "Agree or disagree?" / "Am I wrong here?"' });
        }

        if (!structure.hasCTA) {
            suggestions.push({ priority: 'low', category: 'Call to Action', issue: 'No CTA', action: 'A soft CTA increases bookmark and RT rate', example: '"Save this for later" / "Retweet if this resonates" / "Drop your take below 👇"' });
        }

    } else if (platform === 'facebook') {
        if (content.length < 40) {
            suggestions.push({ priority: 'high', category: 'Content Length', issue: `Too short (${content.length} chars)`, action: 'Facebook posts under 40 chars get 40% less reach. Aim for 40-80 chars for organic posts.', example: 'Add context, a brief story, or a question' });
        } else if (content.length > 500 && content.length < 5000) {
            suggestions.push({ priority: 'medium', category: 'Content Length', issue: `Long post (${content.length} chars)`, action: 'Facebook organic reach drops for very long posts. Front-load your key message in the first 3 lines.', example: 'Hook in line 1-2 → core story → lesson/question (before "See More" cut-off)' });
        }

        if (!structure.hasHook) {
            suggestions.push({ priority: 'high', category: 'Opening Hook', issue: 'Weak opening', action: 'Facebook shows only 3 lines before "See More". Your hook must be in the first sentence.', example: '"I never thought this would happen." / "Something surprised me today." / "True story:"' });
        }

        if (!structure.hasQuestion) {
            suggestions.push({ priority: 'high', category: 'Comments Driver', issue: 'No question', action: 'Facebook algorithm heavily weights comments. Questions are the single most effective tool.', example: '"Have you ever felt this way?" / "What would you do?" / "Am I the only one?"' });
        }

        if (!structure.hasCTA) {
            suggestions.push({ priority: 'medium', category: 'Call to Action', issue: 'No CTA', action: 'Guide genuine interaction — avoid "engagement bait" phrases Facebook penalizes.', example: '"Let me know your experience in the comments" / "Share this with someone who needs it"' });
        }

        if (structure.paragraphs < 2) {
            suggestions.push({ priority: 'medium', category: 'Formatting', issue: 'Single block of text', action: 'Break into 2-4 short paragraphs. White space increases read-through rate by ~40%.', example: 'Structure: Hook (1-2 lines) → Story/Point (2-3 lines) → Lesson/Question (1-2 lines)' });
        }
    }

    return suggestions;
}

// ─────────────────────────────────────────────
// Claude AI 深度分析
// ─────────────────────────────────────────────
async function aiAnalyze(title, content, platform, ruleData) {
    if (!anthropic) return null;

    const isZh = platform === 'xhs';
    const platformName = PLATFORMS[platform].name;
    const violationSummary = ruleData.violations.length > 0
        ? ruleData.violations.map(v => `"${v.keyword}"(${v.level})`).join(', ')
        : (isZh ? '无' : 'none');
    const contentTypeLabel = isZh
        ? (ruleData.contentTypeInfo?.label || '通用')
        : (ruleData.contentTypeInfo?.labelEn || 'General');

    const prompt = isZh ? `你是一位专业的小红书内容运营专家，精通平台算法和合规规则。

待检测内容：
标题：${title || '（无标题）'}
正文：${content}
内容类型：${contentTypeLabel}
规则引擎已检出的违规词：${violationSummary}

请进行AI深度分析，仅返回如下JSON，不要有任何额外文字：
{
  "contextualRisk": "low/medium/high",
  "aiInsight": "对内容合规风险和增长潜力的1-2句专业评价",
  "rewriteTitle": "优化后的标题（10-20字，含情绪词或数字，适合小红书搜索）",
  "rewriteContent": "优化后的正文（修复违规、提升互动性、保留原意，150-400字，含适当emoji和结尾互动引导）",
  "additionalTips": ["规则引擎未识别但重要的建议1", "建议2", "建议3"]
}` : `You are an expert social media strategist for ${platformName}, specializing in compliance and engagement optimization.

Content to analyze:
Title: ${title || '(none)'}
Content: ${content}
Content type: ${contentTypeLabel}
Rule-based violations detected: ${violationSummary}

Return ONLY valid JSON, no extra text:
{
  "contextualRisk": "low/medium/high",
  "aiInsight": "1-2 sentence professional assessment of compliance risk and engagement potential",
  "rewriteTitle": "Optimized title (empty string if platform doesn't use titles)",
  "rewriteContent": "Improved content version (fix violations, boost engagement, preserve intent)",
  "additionalTips": ["Specific tip rule engine missed 1", "tip 2", "tip 3"]
}`;

    try {
        const message = await anthropic.messages.create({
            model: 'claude-haiku-4-5-20251001',
            max_tokens: 1500,
            messages: [{ role: 'user', content: prompt }]
        });
        const text = message.content[0].text.replace(/```json\n?|\n?```/g, '').trim();
        return JSON.parse(text);
    } catch (err) {
        console.error(`Claude AI 分析失败 [${platform}]:`, err.message);
        return null;
    }
}

// ─────────────────────────────────────────────
// API routes
// ─────────────────────────────────────────────
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.post('/api/analyze', async (req, res) => {
    try {
        const { title = '', content, platforms } = req.body;

        if (!content || !platforms || !Array.isArray(platforms) || platforms.length === 0) {
            return res.status(400).json({ error: '缺少必要参数' });
        }
        if (title.length > 5000 || content.length > 5000) {
            return res.status(400).json({ error: '内容超过长度限制（最多 5000 字符）' });
        }

        const validPlatforms = platforms.filter(p => PLATFORM_RULES[p]);
        if (validPlatforms.length === 0) {
            return res.status(400).json({ error: '无效平台' });
        }

        const contentType = detectContentType(title, content);

        // Step 1: 规则引擎分析（同步，快）
        const results = validPlatforms.map(platform => {
            const { violations, complianceScore } = checkViolations(title, content, platform);
            const structure = analyzeStructure(title, content, platform);
            return {
                platform,
                platformName: PLATFORMS[platform].name,
                platformIcon: PLATFORMS[platform].icon,
                charLimits: PLATFORMS[platform].charLimits,
                complianceScore,
                engagementScore: calculateEngagement(title, content, platform, structure),
                viralScore: calculateViral(title, content, platform, structure, contentType),
                readabilityScore: calculateReadability(content, platform),
                violations,
                structure,
                contentType,
                contentTypeInfo: CONTENT_TYPES[contentType],
                optimizations: generateOptimizations(title, content, platform, violations, structure, contentType),
                hashtagSuggestions: suggestHashtags(contentType, platform, content),
                viralFormulas: VIRAL_FORMULAS[platform] || [],
                status: complianceScore >= 80 ? 'safe' : complianceScore >= 50 ? 'warning' : 'danger',
                aiAnalysis: null
            };
        });

        // Step 2: AI 深度分析（并发请求所有平台，有 Key 才执行）
        if (anthropic) {
            await Promise.all(results.map(async (item) => {
                item.aiAnalysis = await aiAnalyze(title, content, item.platform, item);
            }));
        }

        res.json({
            success: true,
            data: results,
            aiEnabled: !!anthropic,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('分析失败:', error);
        res.status(500).json({ error: '分析失败', message: error.message });
    }
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
    console.log(`🚀 SocialFlow 运行于端口 ${PORT}`);
});
