const express = require('express');
const http = require('http');
const WebSocket = require('ws');

const app = express();
let players = {};
let hostId = null; // 最初に接続したプレイヤーのIDを保存
let currentCategory = '食べ物'; // 仮のカテゴリーを設定
// ... その他の変数 ...
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// ゲームのお題リストとカテゴリーを定義
const categories = [
    "動物",
    "食べ物",
    "家電製品",
    "スポーツ",
    "場所"
];

const themes = {
    "動物": ["ライオン", "ゾウ", "パンダ", "キリン", "イルカ", "タコ"],
    "食べ物": ["リンゴ", "バナナ", "カレー", "ラーメン", "おにぎり"],
    "家電製品": ["テレビ", "冷蔵庫", "電子レンジ", "洗濯機", "エアコン"],
    "スポーツ": ["サッカー", "バスケ", "野球", "テニス", "バドミントン"],
    "場所": ["東京タワー", "富士山", "学校", "コンビニ", "公園"]
};

// ゲームの状態を管理するオブジェクト
let gameState = {
    players: {}, // { 'playerId': { name: 'playerName', score: 10, cards: [] } }
    playerCount: 0,
    gameStarted: false,
    currentRound: 0,
    turnOrder: [],
    currentPlayerIndex: 0,
    currentParentPlayer: null,
    currentThemeCategory: null,
    cardsOnMap: [], // [{ text: '文字', playerId: 'id', position: '右上', direction: '正位置' }]
    secretWord: null,
    gameLog: [],
    correctAnswerReceived: false,
    parentHintUsed: false,
    childCardsForParent: [] // 子番が提出したカードを親番に渡すための配列
};

// WebSocket接続確立時の処理
wss.on('connection', ws => {
    // 新しいプレイヤーIDを生成
    const playerId = `player_${Date.now()}`;
    gameState.players[playerId] = {
        name: `Player ${gameState.playerCount + 1}`,
        score: 10,
        cards: [],
        id: playerId,
        ws: ws
    };
    gameState.playerCount++;
    console.log(`Player connected: ${playerId}`);
    
    // プレイヤーにIDと現在の状態を通知
    ws.send(JSON.stringify({ type: 'playerAssigned', playerId: playerId }));
    broadcastGameState();

    // クライアントからのメッセージを受信
    ws.on('message', message => {
        const data = JSON.parse(message);
        
        switch(data.type) {
            case 'setName':
        // プレイヤー名を設定
        gameState.players[playerId].name = data.name;

        // ★★★ 修正・追加部分 ★★★
        // ホストが未設定であれば、このプレイヤーをホストにする
        if (!hostId) {
            hostId = playerId;
        }
        // ★★★ ここまで修正・追加 ★★★
        
        // ゲーム状態をブロードキャスト（次のステップでこの関数を修正します）
        broadcastGameState(); 
        break;
           case 'startGame':
        // ★★★ 修正・確認部分 ★★★
        // 接続時の playerId とホストIDが一致する場合のみ実行
        if (playerId === hostId) {
            if (!gameState.gameStarted && gameState.playerCount >= 1) {
                // startGame() の処理（ゲーム開始のブロードキャスト）
                startGame();
            }
        }
        break;
            case 'submitCards':
                // 子番がカードを提出
                if (gameState.currentParentPlayer !== playerId) {
                    submitCards(data.cards, playerId);
                }
                break;
            case 'placeCard':
                // 親番がカードをマップに配置
                if (gameState.currentParentPlayer === playerId) {
                    placeCard(data.card, data.position, data.direction, data.text);
                }
                break;
            case 'submitAnswer':
                // 子番が解答を提出
                if (gameState.currentParentPlayer !== playerId) {
                    checkAnswer(data.answer, playerId);
                }
                break;
            case 'useParentHint':
                // 親番がヒントを使用
                if (gameState.currentParentPlayer === playerId && gameState.players[playerId].score >= 1) {
                    useParentHint(data.hintType, playerId);
                }
                break;
            case 'useChildHint':
                // 子番がヒントを使用
                if (gameState.currentParentPlayer !== playerId && gameState.players[playerId].score >= 1) {
                    useChildHint(data.question, playerId);
                }
                break;
        }
    });

    ws.on('close', () => {
        console.log(`Player disconnected: ${playerId}`);
        delete gameState.players[playerId];
        gameState.playerCount--;
        broadcastGameState();
    });
});

// ゲーム開始処理
function startGame() {
    gameState.gameStarted = true;
    gameState.turnOrder = shuffle(Object.keys(gameState.players));
    gameState.currentRound = 1;
    startNewRound();
}

// 新しいラウンド開始
function startNewRound() {
    if (gameState.currentRound > Object.keys(gameState.players).length * 2) {
        endGame();
        return;
    }

    gameState.cardsOnMap = [];
    gameState.correctAnswerReceived = false;
    gameState.parentHintUsed = false;
    
    // 親番プレイヤーを決定
    const parentId = gameState.turnOrder[gameState.currentPlayerIndex];
    gameState.currentParentPlayer = parentId;
    
    // カテゴリーとお題をランダムに選ぶ
    const randomCategory = categories[Math.floor(Math.random() * categories.length)];
    gameState.currentThemeCategory = randomCategory;
    const randomTheme = themes[randomCategory][Math.floor(Math.random() * themes[randomCategory].length)];
    gameState.secretWord = randomTheme;
    
    // 全プレイヤーにラウンド開始とカテゴリーを通知
    broadcast({ 
        type: 'roundStart', 
        round: gameState.currentRound, 
        parentPlayerId: parentId,
        parentPlayerName: gameState.players[parentId].name,
        category: randomCategory
    });

    // 価値観統一フェーズの開始
    startPhase('valueUnification');
}

// フェーズの開始
function startPhase(phaseName, data = {}) {
    broadcast({ type: 'startPhase', phase: phaseName, data: data });
}

// カードの提出（子番から親番へ）
function submitCards(cards, playerId) {
    gameState.players[playerId].cards = cards;
    
    const allSubmitted = Object.values(gameState.players).every(p => 
        p.id === gameState.currentParentPlayer || (p.cards && p.cards.length === 3));
    
    if (allSubmitted) {
        // 親番に全ての子番のカードを送信
        const allChildCards = Object.values(gameState.players)
            .filter(p => p.id !== gameState.currentParentPlayer)
            .map(p => p.cards)
            .flat();
        
        // サーバーの状態に保存
        gameState.childCardsForParent = allChildCards;

        startPhase('transmission', { childCards: allChildCards });
    }
}

// 親番によるカード配置
function placeCard(card, position, direction, text) {
    gameState.cardsOnMap.push({ text: text, playerId: gameState.currentParentPlayer, position: position, direction: direction });
    broadcastGameState();
}

// 解答チェック
function checkAnswer(answer, playerId) {
    if (answer === gameState.secretWord && !gameState.correctAnswerReceived) {
        gameState.correctAnswerReceived = true;
        
        // 正解者への得点加算
        gameState.players[playerId].score += 2; // 最初
        gameState.players[gameState.currentParentPlayer].score += 3; // 親番
        
        broadcast({ type: 'correctAnswer', playerId: playerId, answer: answer });
        endRound();
    } else if (answer === gameState.secretWord) {
        gameState.players[playerId].score += 1; // 2番目以降
        broadcast({ type: 'correctAnswer', playerId: playerId, answer: answer, isLate: true });
    } else {
        broadcast({ type: 'incorrectAnswer', playerId: playerId, answer: answer });
    }
}

// 親番によるヒント使用
function useParentHint(hintType, playerId) {
    if (gameState.players[playerId].score >= 1 && !gameState.parentHintUsed) {
        gameState.players[playerId].score--;
        gameState.parentHintUsed = true;
        let hint;
        if (hintType === 'length') {
            hint = { type: 'length', value: gameState.secretWord.length };
        } else {
            hint = { type: 'firstLast', first: gameState.secretWord[0], last: gameState.secretWord[gameState.secretWord.length - 1] };
        }
        broadcast({ type: 'parentHint', hint: hint });
        broadcastGameState();
    }
}

// 子番によるヒント使用
function useChildHint(question, playerId) {
    if (gameState.players[playerId].score >= 1) {
        gameState.players[playerId].score--;
        
        // 親番に質問を送信
        const parentWs = gameState.players[gameState.currentParentPlayer].ws;
        parentWs.send(JSON.stringify({ type: 'childQuestion', playerId: playerId, question: question }));
        broadcastGameState();
    }
}

// ラウンド終了
function endRound() {
    gameState.currentRound++;
    gameState.currentPlayerIndex = (gameState.currentPlayerIndex + 1) % Object.keys(gameState.players).length;
    // 短い時間待機後、次のラウンドを開始
    setTimeout(startNewRound, 5000);
}

// ゲーム終了
function endGame() {
    gameState.gameStarted = false;
    let winner = null;
    let maxScore = -1;
    Object.values(gameState.players).forEach(p => {
        if (p.score > maxScore) {
            maxScore = p.score;
            winner = p;
        }
    });
    broadcast({ type: 'gameEnd', winner: winner });
}

// server.js の broadcastGameState() 関数全体を置き換え
function broadcastGameState() {
    // ⚠ hostId が null でないことを確認し、ホストの名前を取得
    const hostName = hostId && gameState.players[hostId] ? gameState.players[hostId].name : null;

    // クライアントに送るデータ構造を組み立て
    const data = {
        type: 'gameStateUpdate',
        players: gameState.players,
        gameStarted: gameState.gameStarted,
        // ... その他の状態 ...
        hostName: hostName // ★ホスト名をここに追加★
    };
    
    // 全クライアントにブロードキャスト
    Object.values(gameState.players).forEach(p => {
        p.ws.send(JSON.stringify(data));
    });
}

// メッセージを全クライアントに送信
function broadcast(message) {
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify(message));
        }
    });
}

// 配列をシャッフルするユーティリティ関数
function shuffle(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}

// Expressで静的ファイルを提供（クライアントサイドのHTML, CSS, JS）
app.use(express.static('public'));

server.listen(3000, () => {
    console.log('Server is running on http://localhost:3000');
});