const ws = new WebSocket('ws://localhost:3000');
let myId = null;
let gameState = {};

// WebSocketサーバーからのメッセージ受信
ws.onmessage = event => {
    const data = JSON.parse(event.data);
    
    switch(data.type) {
        case 'playerAssigned':
            myId = data.playerId;
            document.getElementById('status').textContent = `あなたのID: ${myId}`;
            break;
        case 'gameStateUpdate':
            gameState = data.state;
            updateUI();
            break;
        case 'roundStart':
            alert(`ラウンド ${data.round} 開始！親番は ${data.parentPlayerName} です。`);
            break;
        case 'startPhase':
            changePhaseUI(data.phase, data.data);
            break;
        case 'correctAnswer':
            alert(`${gameState.players[data.playerId].name} が正解！お題は「${data.answer}」でした！`);
            break;
        case 'incorrectAnswer':
            // チャットに不正解を表示
            console.log(`${gameState.players[data.playerId].name} が不正解: ${data.answer}`);
            break;
        case 'gameEnd':
            alert(`ゲーム終了！勝者は ${data.winner.name} です！`);
            break;
        case 'childQuestion':
            // 親番UI: 子番からの質問を表示
            alert(`${gameState.players[data.playerId].name} から質問です: ${data.question}`);
            // はい/いいえボタンを表示
            break;
        case 'parentHint':
            // 子番UI: 親番からのヒントを表示
            let hintText = '';
            if (data.hint.type === 'length') {
                hintText = `文字数ヒント: ${data.hint.value}文字です`;
            } else {
                hintText = `最初と最後の文字ヒント: ${data.hint.first} ... ${data.hint.last}`;
            }
            alert(hintText);
            break;
    }
};

// UIを更新
function updateUI() {
    // プレイヤーリストとスコアを更新
    const playerList = document.getElementById('player-list');
    playerList.innerHTML = '<h2>プレイヤー</h2>';
    gameState.players.forEach(player => {
        playerList.innerHTML += `<div>${player.name}: ${player.score}点 ${player.id === myId ? '(あなた)' : ''}</div>`;
    });

    // マップ上のカードを更新
    document.querySelectorAll('.area').forEach(area => area.innerHTML = '');
    gameState.cardsOnMap.forEach(card => {
        const cardEl = document.createElement('div');
        cardEl.className = `card ${card.direction}`;
        cardEl.textContent = card.text;
        document.getElementById(card.position).appendChild(cardEl);
    });

    // ゲーム情報（ラウンド、親番など）を更新
    const gameInfo = document.getElementById('game-info');
    gameInfo.innerHTML = `<h3>ラウンド: ${gameState.currentRound} / 親番: ${gameState.currentParentPlayer ? gameState.players.find(p => p.id === gameState.currentParentPlayer).name : '未定'}</h3>`;
    
    // 自分のカードUIを更新
    // ...
}

// 名前を決定
function setPlayerName() {
    const name = document.getElementById('name-input').value;
    if (name) {
        ws.send(JSON.stringify({ type: 'setName', name: name }));
        document.getElementById('start-screen').style.display = 'none';
        document.getElementById('game-screen').style.display = 'block';
    }
}

// ゲーム開始
function startGame() {
    ws.send(JSON.stringify({ type: 'startGame' }));
}

// フェーズごとのUI変更
function changePhaseUI(phase, data) {
    const phaseContainer = document.getElementById('phase-container');
    phaseContainer.innerHTML = ''; // UIをクリア
    
    switch(phase) {
        case 'valueUnification':
            phaseContainer.innerHTML = `
                <h3>価値観統一フェーズ</h3>
                <p>カードを3枚作成し、マップに配置してください。</p>
                <input type="text" id="card1" maxlength="3">
                <input type="text" id="card2" maxlength="3">
                <input type="text" id="card3" maxlength="3">
                <button onclick="submitMyCards()">カード提出</button>
            `;
            // ドラッグ＆ドロップ機能の実装
            // ...
            break;
        case 'cardEntry':
            if (myId === gameState.currentParentPlayer) {
                phaseContainer.innerHTML = `<h3>子番からのカード待ち...</h3>`;
            } else {
                phaseContainer.innerHTML = `
                    <h3>カード記入フェーズ</h3>
                    <p>お題「${data.category}」に関連する3文字のカードを3枚記入してください。</p>
                    <input type="text" id="card1" maxlength="3">
                    <input type="text" id="card2" maxlength="3">
                    <input type="text" id="card3" maxlength="3">
                    <button onclick="submitChildCards()">カード提出</button>
                `;
            }
            break;
        case 'transmission':
            if (myId === gameState.currentParentPlayer) {
                phaseContainer.innerHTML = `
                    <h3>伝達フェーズ (親番)</h3>
                    <p>子番が作成したカードをマップに配置し、お題を伝えてください。</p>
                    <div id="received-cards"></div>
                    <button onclick="useParentHint('length')">文字数ヒント (-1点)</button>
                    <button onclick="useParentHint('firstLast')">最初と最後ヒント (-1点)</button>
                    `;
                displayReceivedCards();
            } else {
                phaseContainer.innerHTML = `
                    <h3>伝達フェーズ (子番)</h3>
                    <p>親番の伝達を見て、お題を考えてください。</p>
                    <input type="text" id="answer-input" placeholder="答えを入力">
                    <button onclick="submitAnswer()">解答送信</button>
                    <button onclick="useChildHint()">秘密の質問 (-1点)</button>
                `;
            }
            break;
        case 'answer':
            // 解答フェーズUI
            break;
    }
}

// 子番が親番にカードを提出
function submitChildCards() {
    const cards = [
        document.getElementById('card1').value,
        document.getElementById('card2').value,
        document.getElementById('card3').value
    ];
    ws.send(JSON.stringify({ type: 'submitCards', cards: cards }));
}

// 子番が解答を送信
function submitAnswer() {
    const answer = document.getElementById('answer-input').value;
    if (answer) {
        ws.send(JSON.stringify({ type: 'submitAnswer', answer: answer }));
    }
}

// 親番が受け取ったカードを表示
function displayReceivedCards() {
    const cardsContainer = document.getElementById('received-cards');
    cardsContainer.innerHTML = '<h4>受け取ったカード</h4>';
    // サーバーから受け取ったカードを表示
    // この部分はサーバーからのデータ送信が必要です
}