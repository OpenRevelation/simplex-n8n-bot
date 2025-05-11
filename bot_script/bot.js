// bot.js
const WebSocket = require('ws');
const axios = require('axios');

const simplexCLIWSURL = process.env.SIMPLEX_CLI_WS_URL || 'ws://localhost:5225';
const N8N_WEBHOOK_URL = process.env.N8N_WEBHOOK_URL;
const N8N_WEBHOOK_TOKEN = process.env.N8N_WEBHOOK_TOKEN;

let wsClient;
let correlationIdCounter = 0;

function connectToSimplexCLI() {
    console.log(`Attempting to connect to SimpleX CLI at ${simplexCLIWSURL}`);
    wsClient = new WebSocket(simplexCLIWSURL);

    wsClient.on('open', () => {
        console.log('Connected to SimpleX CLI WebSocket');
        generateAndSendCommand({ cmd: "/address" });
    });

    wsClient.on('message', (data) => {
        handleIncomingMessageFromCLI(data);
    });

    wsClient.on('close', () => {
        console.log('Disconnected from SimpleX CLI WebSocket. Reconnecting in 5 seconds...');
        setTimeout(connectToSimplexCLI, 5000);
    });

    wsClient.on('error', (error) => {
        console.error('SimpleX CLI WebSocket error:', error.message);
    });
}

function generateAndSendCommand(commandPayload) {
    if (wsClient && wsClient.readyState === WebSocket.OPEN) {
        const corrId = `bot-${Date.now()}-${correlationIdCounter++}`;
        const command = {
            corrId: corrId,
            ...commandPayload
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

function sendMessageToUserInSimplex(contactId, text) {
    const commandPayload = {
        cmd: `@${contactId} ${text}`
    };
    generateAndSendCommand(commandPayload);
}

async function forwardToN8n(senderId, messageText) {
    if (!N8N_WEBHOOK_URL || !N8N_WEBHOOK_TOKEN) {
        console.warn('N8N_WEBHOOK_URL or N8N_WEBHOOK_TOKEN is not configured. Cannot forward message.');
        return;
    }
    const payload = {
        sender: senderId,
        message: messageText
    };
    try {
        console.log(`Forwarding message from ${senderId} to n8n: ${messageText}`);
        await axios.post(N8N_WEBHOOK_URL, payload, {
            headers: {
                'Content-Type': 'application/json',
                'X-Simplex-Bot-Token': N8N_WEBHOOK_TOKEN
            }
        });
        console.log('Message successfully forwarded to n8n.');
    } catch (error) {
        console.error('Error forwarding message to n8n:', error.response ? error.response.data : error.message);
    }
}

function handleIncomingMessageFromCLI(rawData) {
    try {
        const messageString = rawData.toString();
        const messageObj = JSON.parse(messageString);
        console.log('Received from CLI:', JSON.stringify(messageObj, null, 2));

        if (messageObj.cmd && messageObj.cmd === "/address" && messageObj.result) {
            console.log("===== BOT ADDRESS RESPONSE =====");
            console.log(messageObj.result);
            if (typeof messageObj.result === 'string' && messageObj.result.includes('smp://')) {
                console.log("!!!!!!!!!! BOT ADDRESS LIKELY FOUND !!!!!!!!!");
                console.log(messageObj.result);
                console.log("!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!");
            }
            console.log("==============================");
        } else if (messageObj.event === 'x.msg.new' && messageObj.params && messageObj.params.content && messageObj.params.content.type === 'text') {
            const textFromUser = messageObj.params.content.text;
            let senderId = messageObj.sender || messageObj.contactId || (messageObj.params ? messageObj.params.sender : null) || messageObj.peerId;
            if (senderId && textFromUser) {
                console.log(`Message from SimpleX User ${senderId}: ${textFromUser}`);
                if (textFromUser.trim().toLowerCase() === '/help') {
                    sendMessageToUserInSimplex(senderId, "Отправьте любое сообщение, и оно будет переслано в n8n. Команды: /ping.");
                } else if (textFromUser.trim().toLowerCase() === '/ping') {
                    sendMessageToUserInSimplex(senderId, "Pong!");
                } else {
                    forwardToN8n(senderId, textFromUser);
                }
            } else {
                console.warn('Could not identify sender or message text from x.msg.new event:', messageObj);
            }
        } else if (messageObj.cmd && messageObj.result !== undefined) {
            console.log(`Result for other command (corrId ${messageObj.corrId}): ${JSON.stringify(messageObj.result)}`);
        }
    } catch (e) {
        console.error('Failed to parse message from CLI or handle it:', e);
        console.error('Raw data was:', rawData.toString());
    }
}

if (!N8N_WEBHOOK_URL || !N8N_WEBHOOK_TOKEN) {
    console.warn('N8N_WEBHOOK_URL and/or N8N_WEBHOOK_TOKEN are not set in environment variables. n8n integration will be disabled.');
}
connectToSimplexCLI();