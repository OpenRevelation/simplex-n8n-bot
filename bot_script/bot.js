// bot.js
const WebSocket = require('ws');
const axios = require('axios'); // Для отправки запросов в n8n

// --- Конфигурация (берется из переменных окружения) ---
const simplexCLIWSURL = process.env.SIMPLEX_CLI_WS_URL || 'ws://localhost:5225'; // Должно быть ws://localhost:5225 из supervisord
const N8N_WEBHOOK_URL = process.env.N8N_WEBHOOK_URL; // Будет определена в Railway
const N8N_WEBHOOK_TOKEN = process.env.N8N_WEBHOOK_TOKEN; // Будет определен в Railway
                                                          // (Это токен для ЗАГОЛОВКА Header Auth в n8n)
// Если будешь делать API для команд от n8n к боту:
// const N8N_BOT_API_PORT = process.env.N8N_BOT_API_PORT || 3001;
// const N8N_BOT_API_TOKEN = process.env.N8N_BOT_API_TOKEN;


let wsClient;
let correlationIdCounter = 0;

// --- Функции WebSocket для связи с SimpleX CLI ---
function connectToSimplexCLI() {
    console.log(`Attempting to connect to SimpleX CLI at ${simplexCLIWSURL}`);
    wsClient = new WebSocket(simplexCLIWSURL);

    wsClient.on('open', () => {
        console.log('Connected to SimpleX CLI WebSocket');
        // Можно отправить команду для получения информации о профиле бота, если необходимо
        // generateAndSendCommand({ cmd: "/prof" }); 
        // или для получения адреса бота, чтобы вывести в лог
        generateAndSendCommand({ cmd: "/address" }); 
    });

    wsClient.on('message', (data) => {
        handleIncomingMessageFromCLI(data);
    });

    wsClient.on('close', () => {
        console.log('Disconnected from SimpleX CLI WebSocket. Reconnecting in 5 seconds...');
        setTimeout(connectToSimplexCLI, 5000); // Попытка переподключения
    });

    wsClient.on('error', (error) => {
        console.error('SimpleX CLI WebSocket error:', error.message);
        // wsClient.close() будет вызвано автоматически, что приведет к переподключению
    });
}

function generateAndSendCommand(commandPayload) {
    if (wsClient && wsClient.readyState === WebSocket.OPEN) {
        const corrId = `bot-<span class="math-inline">\{Date\.now\(\)\}\-</span>{correlationIdCounter++}`;
        const command = {
            corrId: corrId,
           ...commandPayload // commandPayload должен содержать поле cmd, например, { cmd: "@user123 Hello!" }
        };
        const commandString = JSON.stringify(command);
        console.log(`Sending to CLI: ${commandString}`);
        wsClient.send(commandString);
        return corrId;
    } else {
        console.error('Cannot send command: WebSocket is not open.');
        return null;
    }
}

// Функция для отправки сообщения пользователю SimpleX через CLI
function sendMessageToUserInSimplex(contactId, text) {
    // contactId здесь - это идентификатор, который понимает CLI SimpleX
    const commandPayload = {
        cmd: `@${contactId} ${text}`
    };
    generateAndSendCommand(commandPayload);
}

// --- Обработка сообщений от SimpleX CLI и взаимодействие с n8n ---
async function forwardToN8n(senderId, messageText) {
    if (!N8N_WEBHOOK_URL || !N8N_WEBHOOK_TOKEN) {
        console.warn('N8N_WEBHOOK_URL or N8N_WEBHOOK_TOKEN is not configured. Cannot forward message.');
        // sendMessageToUserInSimplex(senderId, "Извините, сервис временно недоступен."); // Раскомментируй, если хочешь отвечать об ошибке
        return;
    }

    const payload = {
        sender: senderId, // Идентификатор отправителя из SimpleX
        message: messageText     // Текст сообщения от пользователя
    };

    try {
        console.log(`Forwarding message from ${senderId} to n8n: ${messageText}`);
        // Важно: N8N_WEBHOOK_TOKEN здесь используется как значение для заголовка,
        // имя заголовка (например, X-Bot-Token или X-Simplex-Bot-Token) должно совпадать
        // с тем, что ты настроишь в узле Webhook в n8n (в поле "Name" для Header Auth).
        await axios.post(N8N_WEBHOOK_URL, payload, {
            headers: { 
                'Content-Type': 'application/json',
                'X-Simplex-Bot-Token': N8N_WEBHOOK_TOKEN // Пример имени заголовка
            }
        });
        // Опционально: подтверждение пользователю, что сообщение передано
        // sendMessageToUserInSimplex(senderId, "Ваше сообщение обрабатывается...");
        console.log('Message successfully forwarded to n8n.');
    } catch (error) {
        console.error('Error forwarding message to n8n:', error.response ? error.response.data : error.message);
        // sendMessageToUserInSimplex(senderId, "Произошла ошибка при передаче вашего сообщения в n8n.");
    }
}

function handleIncomingMessageFromCLI(rawData) {
    try {
        const messageString = rawData.toString();
        const messageObj = JSON.parse(messageString);

        // Выводим все сообщения от CLI для отладки
        console.log('Received from CLI:', JSON.stringify(messageObj, null, 2));

        // Обработка нового сообщения от пользователя
        if (messageObj.event === 'x.msg.new' && messageObj.params && messageObj.params.content && messageObj.params.content.type === 'text') {
            const textFromUser = messageObj.params.content.text;

            // Идентификация отправителя. В твоем исследовании указано, что это сложный момент.
            // "SimpleX протокол не передает senderId в самом сообщении x.msg.new [19]"
            // "Идентификация происходит по соединению."
            // "CLI должен как-то сообщать, от какого контакта пришло сообщение."
            // "В Robosats-Orderbook-Alert-Bot-for-SimpleX-Chat упоминается contactId.[12]"
            // Допустим, CLI добавляет поле `senderName` или `contactId` в объект сообщения.
            // Или ты используешь SDK, который это абстрагирует.
            // ВАЖНО: Тебе нужно будет адаптировать эту часть под то, как ТВОЙ SimpleX Chat CLI
            // будет передавать идентификатор отправителя.
            // В твоем исследовании (раздел 3.3) есть предположение:
            // const internalSenderId = messageObj.sender; 
            // Давай будем использовать это предположение или `messageObj.contactId`

            let senderId = messageObj.sender || messageObj.contactId || (messageObj.params ? messageObj.params.sender : null) || messageObj.peerId; // Пробуем разные возможные поля

            if (senderId && textFromUser) {
                console.log(`Message from SimpleX User ${senderId}: ${textFromUser}`);

                // Пример простых команд, обрабатываемых ботом напрямую
                if (textFromUser.trim().toLowerCase() === '/help') {
                    sendMessageToUserInSimplex(senderId, "Отправьте любое сообщение, и оно будет переслано в n8n. Команды: /ping.");
                } else if (textFromUser.trim().toLowerCase() === '/ping') {
                    sendMessageToUserInSimplex(senderId, "Pong!");
                } else {
                    // Пересылка сообщения в n8n
                    forwardToN8n(senderId, textFromUser);
                }
            } else {
                console.warn('Could not identify sender or message text from x.msg.new event:', messageObj);
            }
        } else if (messageObj.cmd && messageObj.cmd === "/address" && messageObj.result) {
            // Если это ответ на нашу команду /address
            console.log("===== BOT ADDRESS =====");
            console.log(messageObj.result); // Выводим адрес бота в лог
            console.log("=======================");
        } else if (messageObj.cmd && messageObj.result !== undefined) {
            // Ответ на другую команду, отправленную ботом
            console.log(`Result for command (corrId ${messageObj.corrId}): ${JSON.stringify(messageObj.result)}`);
        } else if (messageObj.event) {
            // Другие события от CLI
            // console.log(`Received event from CLI: ${messageObj.event}`, messageObj);
        }

    } catch (e) {
        console.error('Failed to parse message from CLI or handle it:', e);
        console.error('Raw data was:', rawData.toString());
    }
}

// --- (Опционально) HTTP сервер для получения команд от n8n (для двусторонней связи) ---
// Если n8n должен будет отправлять сообщения пользователям SimpleX через этого бота.
// Для этого нужно будет установить express: npm install express
// И раскомментировать этот блок + настроить переменные N8N_BOT_API_PORT и N8N_BOT_API_TOKEN
/*
const express = require('express');
const app = express();
app.use(express.json());

const N8N_BOT_API_PORT = process.env.N8N_BOT_API_PORT || 3001;
const N8N_BOT_API_TOKEN = process.env.N8N_BOT_API_TOKEN;

app.post('/send-simplex-message', (req, res) => {
    const providedToken = req.headers['x-n8n-token']; // Пример заголовка, который n8n будет отправлять
    if (!N8N_BOT_API_TOKEN || providedToken !== N8N_BOT_API_TOKEN) {
        console.warn('Unauthorized attempt to /send-simplex-message from n8n');
        return res.status(403).json({ error: 'Forbidden' });
    }

    const { recipientId, text } = req.body;
    if (!recipientId || !text) {
        return res.status(400).json({ error: 'Missing recipientId or text' });
    }

    try {
        sendMessageToUserInSimplex(recipientId, text);
        console.log(`Message sent to SimpleX User ${recipientId} via n8n request: ${text}`);
        res.status(200).json({ success: true, message: 'Message queued for SimpleX user.' });
    } catch (e) {
        console.error('Error sending message via n8n request:', e);
        res.status(500).json({ error: 'Failed to send message' });
    }
});

app.listen(N8N_BOT_API_PORT, '0.0.0.0', () => { // Слушаем на 0.0.0.0 для доступности в Docker
    console.log(`Bot API server for n8n listening on port ${N8N_BOT_API_PORT}`);
    // Если используешь этот API, не забудь открыть порт в Dockerfile (EXPOSE)
    // и в настройках Railway, если нужно, чтобы он был доступен извне.
    // Для связи n8n -> бот внутри одной сети Railway, внешний доступ может не понадобиться.
});
*/

// --- Запуск ---
if (!N8N_WEBHOOK_URL || !N8N_WEBHOOK_TOKEN) {
    console.warn('N8N_WEBHOOK_URL and/or N8N_WEBHOOK_TOKEN are not set in environment variables. n8n integration will be disabled.');
}
connectToSimplexCLI(); // Начинаем подключение к SimpleX CLI