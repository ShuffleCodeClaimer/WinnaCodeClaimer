// ==UserScript==
// @name         Winna Code Claimer
// @namespace    http://www.winnacodeclaimer.com/
// @version      2.0.0
// @description  Winna Code Claimer - Auto-Detection + VIP Panel Claiming
// @author       ThaGoofy
// @license      MIT
// @match        https://winna.com/*
// @match        https://www.winna.com/*
// @grant        GM_openInTab
// @grant        GM_notification
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        window.close
// @grant        GM_getTab
// @connect      *
// @icon         https://i.postimg.cc/nzFyHTZk/image.png
// @run-at       document-start
// @noframes
// ==/UserScript==

console.log('%c🚨 WINNA CODE CLAIMER IS RUNNING! 🚨', 'background: #0088ff; color: white; font-size: 20px; padding: 10px;');
console.log('Script loaded at:', new Date().toISOString());
console.log('Current URL:', window.location.href);

(function() {
    'use strict';

    const API_URL = 'https://f60384f7-8a49-49af-a7e2-54702a536e1d-00-17fwi3mcegvcj.janeway.replit.dev';
    const WINNA_API = 'https://api2.winna.com';
    
    GM_deleteValue('accessToken');
    GM_deleteValue('refreshToken');
    GM_deleteValue('isAuthenticated');
    
    let clearTimestamp = parseInt(GM_getValue('clearTimestamp', '0'));
    let storedCodesStr = GM_getValue('localCodes', '[]');
    let storedCodes = [];
    
    try {
        if (typeof storedCodesStr === 'string') {
            storedCodes = JSON.parse(storedCodesStr);
        } else if (Array.isArray(storedCodesStr)) {
            storedCodes = storedCodesStr;
        }
    } catch (e) {
        console.warn('Failed to parse stored codes, starting fresh:', e);
        storedCodes = [];
    }
    
    let codes = storedCodes.filter(code => {
        if (clearTimestamp > 0) {
            const codeTimestamp = new Date(code.timestamp).getTime();
            return codeTimestamp >= clearTimestamp;
        }
        return true;
    });
    
    if (codes.length !== storedCodes.length) {
        GM_setValue('localCodes', JSON.stringify(codes));
        console.log(`🧹 Filtered out ${storedCodes.length - codes.length} old codes from storage`);
    }
    
    let processedCodesStr = GM_getValue('processedCodes', '{}');
    let processedCodes = {};
    try {
        if (typeof processedCodesStr === 'string') {
            processedCodes = JSON.parse(processedCodesStr);
        } else if (typeof processedCodesStr === 'object') {
            processedCodes = processedCodesStr;
        }
    } catch (e) {
        console.warn('Failed to parse processed codes:', e);
        processedCodes = {};
    }
    
    let claimOutcomes = {};
    let activeClaims = {};
    let connectionTimestamp = parseInt(GM_getValue('connectionTimestamp', '0')) || null;
    let winnaUsername = GM_getValue('winnaUsername', null);
    let winnaUserId = GM_getValue('winnaUserId', null);
    let isAuthenticated = GM_getValue('isAuthenticated', false);
    let accessToken = GM_getValue('accessToken', null);
    let refreshToken = GM_getValue('refreshToken', null);
    let subscriptionExpiry = GM_getValue('subscriptionExpiry', null);
    let claimInProgress = false;
    
    let telegramLinked = GM_getValue('telegramLinked', false);
    let telegramNotifyEnabled = GM_getValue('telegramNotifyEnabled', false);
    
    const TIMEOUTS = {
        USERNAME_CHECK: 1000,
        HEARTBEAT: 30000,
        UI_UPDATE: 50
    };
    
    function saveCodesLocal() {
        GM_setValue('localCodes', JSON.stringify(codes));
        GM_setValue('processedCodes', JSON.stringify(processedCodes));
    }
    
    function clearAllCodes() {
        if (confirm('Clear all codes from dashboard?')) {
            codes = [];
            processedCodes = {};
            claimOutcomes = {};
            clearTimestamp = Date.now();
            GM_setValue('localCodes', '[]');
            GM_setValue('processedCodes', '{}');
            GM_setValue('clearTimestamp', clearTimestamp.toString());
            updateCodesList();
            updateUI();
            console.log('🗑️ All codes cleared');
        }
    }
    
    let ws = null;
    let wsConnected = false;
    let wsReconnectAttempts = 0;
    const WS_MAX_RECONNECT_ATTEMPTS = 10;
    const WS_RECONNECT_DELAY = 2000;
    let wsHeartbeatInterval = null;
    
    function getWebSocketUrl() {
        const url = new URL(API_URL);
        const protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
        return `${protocol}//${url.host}/ws`;
    }
    
    function connectWebSocket() {
        if (!isAuthenticated || !accessToken) {
            console.log('⚠️ Cannot connect WebSocket - not authenticated');
            return;
        }
        
        if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
            console.log('⚠️ WebSocket already connected/connecting');
            return;
        }
        
        const wsUrl = getWebSocketUrl();
        console.log(`🔌 Connecting WebSocket to ${wsUrl}...`);
        
        try {
            ws = new WebSocket(wsUrl);
            
            ws.onopen = () => {
                console.log('🔌 WebSocket connected, authenticating...');
                ws.send(JSON.stringify({
                    type: 'auth',
                    token: accessToken
                }));
            };
            
            ws.onmessage = (event) => {
                try {
                    const msg = JSON.parse(event.data);
                    handleWebSocketMessage(msg);
                } catch (e) {
                    console.error('WS message parse error:', e);
                }
            };
            
            ws.onclose = (event) => {
                console.log(`🔌 WebSocket closed: ${event.code} ${event.reason}`);
                wsConnected = false;
                stopWsHeartbeat();
                
                if (isAuthenticated && wsReconnectAttempts < WS_MAX_RECONNECT_ATTEMPTS) {
                    const delay = WS_RECONNECT_DELAY * Math.pow(1.5, wsReconnectAttempts);
                    wsReconnectAttempts++;
                    console.log(`🔄 Reconnecting in ${delay}ms (attempt ${wsReconnectAttempts})...`);
                    setTimeout(connectWebSocket, delay);
                }
            };
            
            ws.onerror = (error) => {
                console.error('🔌 WebSocket error:', error);
            };
            
        } catch (e) {
            console.error('Failed to create WebSocket:', e);
        }
    }
    
    function handleWebSocketMessage(msg) {
        switch (msg.type) {
            case 'auth_success':
                console.log('✅ WebSocket authenticated!');
                wsConnected = true;
                wsReconnectAttempts = 0;
                
                if (msg.recentCodes && Array.isArray(msg.recentCodes)) {
                    processIncomingCodes(msg.recentCodes);
                }
                
                startWsHeartbeat();
                break;
                
            case 'auth_error':
                console.error('❌ WebSocket auth failed:', msg.message);
                ws.close();
                break;
                
            case 'new_code':
                console.log('📥 WebSocket: New code received!', msg.code?.code);
                if (msg.code) {
                    processIncomingCodes([msg.code]);
                }
                break;
                
            case 'pong':
                break;
        }
    }
    
    function processIncomingCodes(backendCodes) {
        const clearTs = parseInt(GM_getValue('clearTimestamp', '0'));
        
        for (const bc of backendCodes) {
            if (bc.timestamp < clearTs) continue;
            if (processedCodes[bc.code]) continue;
            if (codes.find(c => c.code === bc.code)) continue;
            
            const newCode = {
                code: bc.code,
                timestamp: bc.timestamp,
                amount: bc.amount || bc.value || 'N/A',
                wager: bc.wagerRequirement || bc.wager || 'Unknown',
                deadline: bc.timeline || bc.deadline || 'N/A',
                limit: bc.limit || '-',
                claimed: false,
                rejectionReason: null
            };
            
            codes.unshift(newCode);
            saveCodesLocal();
            updateCodesList();
            
            console.log(`🆕 New code: ${bc.code}`);
            
            GM_notification({
                title: '🎰 NEW CODE!',
                text: `${bc.code} - ${newCode.amount}`,
                timeout: 3000
            });
            
            setTimeout(() => {
                triggerAutoClaim(newCode);
            }, 100);
        }
    }
    
    function startWsHeartbeat() {
        if (wsHeartbeatInterval) return;
        
        wsHeartbeatInterval = setInterval(() => {
            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({
                    type: 'ping',
                    username: winnaUsername
                }));
            }
        }, 25000);
    }
    
    function stopWsHeartbeat() {
        if (wsHeartbeatInterval) {
            clearInterval(wsHeartbeatInterval);
            wsHeartbeatInterval = null;
        }
    }
    
    function disconnectWebSocket() {
        stopWsHeartbeat();
        if (ws) {
            ws.close();
            ws = null;
        }
        wsConnected = false;
        wsReconnectAttempts = 0;
    }
    
    function resolveClaim(codeSlug, success, reason = null) {
        if (claimOutcomes[codeSlug]) {
            delete activeClaims[codeSlug];
            return false;
        }
        
        claimOutcomes[codeSlug] = success ? 'success' : 'rejected';
        processedCodes[codeSlug] = Date.now();
        GM_setValue('processedCodes', processedCodes);
        
        delete activeClaims[codeSlug];
        
        console.log(`${success ? '✅' : '❌'} ${codeSlug}: ${success ? 'SUCCESS' : reason}`);
        
        const codeIndex = codes.findIndex(c => c.code === codeSlug);
        if (codeIndex >= 0) {
            codes[codeIndex].claimed = success;
            codes[codeIndex].rejectionReason = reason;
            saveCodesLocal();
            updateCodesList();
            updateUI();
        }
        
        GM_notification({
            title: success ? '✅ Claimed!' : '❌ Rejected',
            text: success ? codeSlug : `${codeSlug}: ${reason}`,
            timeout: 3000
        });
        
        sendClaimResultToBackend(codeSlug, success, reason);
        
        setTimeout(() => closeVIPModal(), 100);
        
        return true;
    }
    
    function closeVIPModal() {
        console.log('🚪 Closing VIP modal...');
        
        const closeButton = document.querySelector('svg path[d*="m12.01 13.14"]')?.closest('button') ||
                           document.querySelector('button svg[viewBox="0 0 24 24"]')?.closest('button') ||
                           [...document.querySelectorAll('button')].find(btn => {
                               const svg = btn.querySelector('svg');
                               return svg && svg.innerHTML.includes('12.01') && svg.innerHTML.includes('13.14');
                           }) ||
                           document.querySelector('[class*="modal"] button:has(svg)') ||
                           document.querySelector('button[aria-label="close"]') ||
                           document.querySelector('button[aria-label="Close"]');
        
        if (closeButton) {
            closeButton.click();
            console.log('✅ VIP modal closed');
        } else {
            document.body.click();
            console.log('⚠️ Close button not found, clicked body to dismiss');
        }
    }
    
    function sendClaimResultToBackend(code, success, message) {
        if (!accessToken) return;
        
        GM_xmlhttpRequest({
            method: 'POST',
            url: `${API_URL}/api/claim-result`,
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${accessToken}`
            },
            data: JSON.stringify({
                code: code,
                success: success,
                message: message
            }),
            onload: (response) => {
                console.log(`📤 Claim result sent: ${code} - ${success ? 'SUCCESS' : 'REJECTED'}`);
            },
            onerror: (error) => {
                console.error('Failed to send claim result:', error);
            }
        });
    }
    
    async function triggerAutoClaim(codeData) {
        const codeSlug = codeData.code.toLowerCase();
        
        if (activeClaims[codeSlug] || claimOutcomes[codeSlug]) {
            console.log(`⏭️ Skipping ${codeSlug} - already processing or processed`);
            return;
        }
        
        activeClaims[codeSlug] = true;
        claimInProgress = true;
        
        console.log(`\n🎰 ========== AUTO-CLAIMING: ${codeSlug} ==========`);
        
        try {
            await openVIPPanel();
            await expandRedeemSection();
            await enterCodeAndSubmit(codeSlug);
            
        } catch (error) {
            console.error(`❌ Auto-claim failed for ${codeSlug}:`, error);
            resolveClaim(codeSlug, false, error.message);
        } finally {
            delete activeClaims[codeSlug];
            claimInProgress = false;
        }
    }
    
    function waitForElement(selector, customFinder = null, timeout = 2000) {
        return new Promise((resolve, reject) => {
            const el = customFinder ? customFinder() : document.querySelector(selector);
            if (el) return resolve(el);
            
            const observer = new MutationObserver(() => {
                const el = customFinder ? customFinder() : document.querySelector(selector);
                if (el) {
                    observer.disconnect();
                    resolve(el);
                }
            });
            observer.observe(document.body, { childList: true, subtree: true });
            
            setTimeout(() => {
                observer.disconnect();
                reject(new Error(`Timeout: ${selector}`));
            }, timeout);
        });
    }
    
    async function openVIPPanel() {
        console.log('🔵 Step 1: Opening VIP panel...');
        
        const btn = await waitForElement(null, () => 
            document.querySelector('button:has(svg circle)') ||
            [...document.querySelectorAll('button')].find(b => b.textContent.includes('VIP') && b.querySelector('svg'))
        );
        
        btn.click();
        console.log('✅ VIP button clicked');
    }
    
    async function expandRedeemSection() {
        console.log('🔵 Step 2: Expanding Redeem promo code section...');
        
        const redeemButton = await waitForElement(null, () => 
            [...document.querySelectorAll('button')].find(btn => 
                btn.textContent.includes('Redeem a promo code') || 
                btn.querySelector('h3')?.textContent?.includes('Redeem')
            )
        );
        
        redeemButton.click();
        console.log('✅ Redeem section expanded');
    }
    
    async function enterCodeAndSubmit(code) {
        console.log(`🔵 Step 3: Entering code ${code} and submitting...`);
        
        const input = await waitForElement('input[name="promoCode"]');
        console.log(`✅ Found input field: ${input.name}`);
        
        const lowerCode = code.toLowerCase();
        
        input.focus();
        input.click();
        
        const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        nativeInputValueSetter.call(input, lowerCode);
        
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        
        console.log(`✅ Code set: ${lowerCode}`);
        
        const applyButton = await waitForElement(null, () => {
            const form = input.closest('form');
            if (form) {
                const btn = form.querySelector('button[type="submit"]') ||
                           [...form.querySelectorAll('button')].find(b => b.textContent.toLowerCase().includes('apply'));
                if (btn && !btn.disabled) return btn;
            }
            const btn = [...document.querySelectorAll('button')].find(b => b.textContent.toLowerCase().trim() === 'apply');
            return btn && !btn.disabled ? btn : null;
        });
        
        console.log(`🖱️ Clicking Apply button...`);
        applyButton.click();
        console.log('✅ Apply button clicked');
        
        monitorClaimResult(code);
    }
    
    
    function monitorClaimResult(code) {
        console.log(`👁️ Monitoring API response for ${code}...`);
        
        let resolved = false;
        const timeout = 10000;
        
        const handleResponse = (response) => {
            if (resolved) return;
            
            if (response.message) {
                const key = response.message.key || response.message;
                const value = response.message.value;
                
                console.log(`📡 API Response - Key: ${key}, Value: ${value}`);
                
                if (key.includes('ERROR') || key.includes('INVALID') || key.includes('EXPIRED') || 
                    key.includes('ALREADY') || key.includes('LIMIT') || key.includes('MINIMUM_WAGER')) {
                    resolved = true;
                    const reason = `${key}${value ? ` (${value})` : ''}`;
                    console.log(`❌ Code rejected: ${reason}`);
                    resolveClaim(code, false, reason);
                } else {
                    resolved = true;
                    console.log(`✅ Code success: ${key}`);
                    resolveClaim(code, true, null, value);
                }
            } else if (response.success === true || response.bonus || response.amount) {
                resolved = true;
                const value = response.amount || response.bonus?.amount || response.value;
                console.log(`✅ Code claimed successfully! Value: ${value}`);
                resolveClaim(code, true, null, value);
            } else if (response.error || response.success === false) {
                resolved = true;
                const reason = response.error || response.message || 'Unknown error';
                console.log(`❌ Code rejected: ${reason}`);
                resolveClaim(code, false, reason);
            }
        };
        
        const originalXHROpen = XMLHttpRequest.prototype.open;
        const originalXHRSend = XMLHttpRequest.prototype.send;
        
        XMLHttpRequest.prototype.open = function(method, url, ...rest) {
            this._url = url;
            return originalXHROpen.apply(this, [method, url, ...rest]);
        };
        
        XMLHttpRequest.prototype.send = function(body) {
            if (this._url && this._url.includes('api2.winna.com/v2/bonus')) {
                this.addEventListener('load', function() {
                    try {
                        const data = JSON.parse(this.responseText);
                        console.log(`🔍 Intercepted XHR bonus response:`, data);
                        handleResponse(data);
                    } catch (e) {
                        console.log('Failed to parse XHR response:', e);
                    }
                });
            }
            return originalXHRSend.apply(this, [body]);
        };
        
        const originalFetch = window.fetch;
        window.fetch = async function(...args) {
            const response = await originalFetch.apply(this, args);
            
            const url = args[0]?.url || args[0];
            if (url && url.includes('api2.winna.com/v2/bonus')) {
                try {
                    const clonedResponse = response.clone();
                    const data = await clonedResponse.json();
                    console.log(`🔍 Intercepted fetch bonus response:`, data);
                    handleResponse(data);
                } catch (e) {
                    console.log('Failed to parse fetch response:', e);
                }
            }
            
            return response;
        };
        
        const observer = new MutationObserver((mutations) => {
            if (resolved) return;
            
            for (const mutation of mutations) {
                for (const node of mutation.addedNodes) {
                    if (node.nodeType !== 1) continue;
                    const text = node.textContent?.toLowerCase() || '';
                    
                    if (text.includes('wagered at least')) {
                        const match = text.match(/\$?([\d,]+)/);
                        resolved = true;
                        observer.disconnect();
                        resolveClaim(code, false, `Minimum wager required: ${match ? match[0] : 'N/A'}`);
                        return;
                    }
                    
                    if (text.includes('successfully') || text.includes('bonus added') || text.includes('claimed')) {
                        resolved = true;
                        observer.disconnect();
                        resolveClaim(code, true);
                        return;
                    }
                    
                    if (text.includes('invalid') || text.includes('expired') || text.includes('already used')) {
                        resolved = true;
                        observer.disconnect();
                        resolveClaim(code, false, text.substring(0, 100));
                        return;
                    }
                }
            }
        });
        
        observer.observe(document.body, { childList: true, subtree: true });
        
        setTimeout(() => {
            window.fetch = originalFetch;
            XMLHttpRequest.prototype.open = originalXHROpen;
            XMLHttpRequest.prototype.send = originalXHRSend;
            observer.disconnect();
            
            if (!resolved) {
                const errorText = document.body.innerText;
                if (errorText.includes('wagered at least')) {
                    const match = errorText.match(/wagered at least \$?([\d,]+)/i);
                    resolveClaim(code, false, `Minimum wager: ${match ? match[1] : 'required'}`);
                } else {
                    console.log(`⏱️ Timeout monitoring ${code}`);
                    resolveClaim(code, false, 'No response detected');
                }
            }
        }, timeout);
    }
    
    async function handleManualClaim() {
        const input = document.getElementById('manual-code-input');
        const code = input?.value?.trim()?.toLowerCase();
        
        if (!code) {
            alert('Please enter a code');
            return;
        }
        
        console.log(`⚡ Manual claim triggered: ${code}`);
        
        const newCode = {
            code: code,
            timestamp: Date.now(),
            amount: 'Manual',
            wager: 'Unknown',
            deadline: 'N/A',
            limit: '-',
            claimed: false,
            rejectionReason: null
        };
        
        if (!codes.find(c => c.code === code)) {
            codes.unshift(newCode);
            saveCodesLocal();
            updateCodesList();
        }
        
        input.value = '';
        closeManualPanel();
        
        await triggerAutoClaim(newCode);
    }
    
    function toggleManualPanel() {
        const panel = document.getElementById('winna-manual-panel');
        if (panel) {
            panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
            if (panel.style.display === 'block') {
                document.getElementById('manual-code-input')?.focus();
            }
        }
    }
    
    function closeManualPanel() {
        const panel = document.getElementById('winna-manual-panel');
        if (panel) panel.style.display = 'none';
    }
    
    let isConnecting = false;
    
    function getWinnaUsername() {
        try {
            const username = localStorage.getItem('wn-username');
            if (username) {
                console.log('🔍 Found username in wn-username:', username);
                return username;
            }
            return null;
        } catch (e) {
            return null;
        }
    }
    
    function getWinnaUserId() {
        try {
            const userId = localStorage.getItem('wn-uid');
            if (userId) {
                return userId;
            }
            
            const cookies = document.cookie.split(';');
            for (const cookie of cookies) {
                const [name, value] = cookie.trim().split('=');
                if (name.trim() === 'wn-uid' || name.includes('uid')) {
                    return value;
                }
            }
            
            return null;
        } catch (e) {
            return null;
        }
    }
    
    async function fetchWinnaUsername(userId) {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: 'GET',
                url: `${WINNA_API}/v1/user`,
                headers: {
                    'Accept': 'application/json',
                    'Origin': 'https://winna.com',
                    'Referer': 'https://winna.com/',
                    'x-auth-uid': userId.toString()
                },
                onload: function(response) {
                    try {
                        const data = JSON.parse(response.responseText);
                        if (data.success && data.response?.payload?.username) {
                            resolve({
                                username: data.response.payload.username,
                                id: data.response.payload.id
                            });
                        } else {
                            reject(new Error('No username in response'));
                        }
                    } catch (e) {
                        reject(e);
                    }
                },
                onerror: reject
            });
        });
    }
    
    function detectWinnaUser() {
        const balanceEl = document.querySelector('[class*="balance"], [class*="Balance"]');
        const vipEl = document.querySelector('button:has(svg circle)');
        const profileEl = document.querySelector('[class*="profile"], [class*="avatar"]');
        
        return !!(balanceEl || vipEl || profileEl);
    }
    
    function resetAuthState(options = {}) {
        const { keepCodes = false, newUsername = null } = options;
        
        console.log('🔄 RESETTING AUTH STATE');
        
        disconnectWebSocket();
        
        isAuthenticated = false;
        accessToken = null;
        refreshToken = null;
        subscriptionExpiry = null;
        connectionTimestamp = null;
        winnaUsername = newUsername;
        winnaUserId = null;
        isConnecting = false;
        
        telegramLinked = false;
        telegramNotifyEnabled = false;
        
        if (!keepCodes) {
            codes = [];
            processedCodes = {};
            claimOutcomes = {};
            GM_setValue('localCodes', '[]');
            GM_setValue('processedCodes', '{}');
        }
        
        GM_deleteValue('accessToken');
        GM_deleteValue('refreshToken');
        GM_deleteValue('isAuthenticated');
        GM_deleteValue('subscriptionExpiry');
        GM_deleteValue('connectionTimestamp');
        GM_deleteValue('winnaUsername');
        GM_deleteValue('winnaUserId');
        GM_deleteValue('telegramLinked');
        GM_deleteValue('telegramNotifyEnabled');
        
        console.log('✅ Auth state reset');
        
        const header = document.getElementById('winna-header');
        if (header) header.remove();
        const showBtn = document.getElementById('winna-show-btn');
        if (showBtn) showBtn.remove();
        const panel = document.getElementById('winna-panel');
        if (panel) panel.remove();
        const manualPanel = document.getElementById('winna-manual-panel');
        if (manualPanel) manualPanel.remove();
        
        injectUI();
    }
    
    function autoConnectWithUsername(detectedUsername, userId) {
        if (isConnecting) {
            console.log('⏳ Connection already in progress, skipping...');
            return;
        }
        
        if (!detectedUsername) {
            console.log('❌ No username to connect with');
            return;
        }
        
        isConnecting = true;
        winnaUsername = detectedUsername;
        winnaUserId = userId;
        console.log(`🔗 Auto-connecting with username: ${winnaUsername}`);
        updateStatus(`🔗 Connecting ${winnaUsername}...`);
        
        GM_xmlhttpRequest({
            method: 'POST',
            url: `${API_URL}/api/auth/connect`,
            headers: { 'Content-Type': 'application/json' },
            data: JSON.stringify({ winnaUsername: winnaUsername }),
            timeout: 10000,
            onload: function(response) {
                isConnecting = false;
                try {
                    const data = JSON.parse(response.responseText);
                    
                    if (response.status === 200 && data.accessToken) {
                        accessToken = data.accessToken;
                        refreshToken = data.refreshToken;
                        isAuthenticated = true;
                        connectionTimestamp = Date.now();
                        subscriptionExpiry = data.expiryAt;
                        
                        telegramLinked = data.telegramLinked || false;
                        telegramNotifyEnabled = data.telegramNotifyEnabled || false;
                        
                        GM_setValue('accessToken', accessToken);
                        GM_setValue('refreshToken', refreshToken);
                        GM_setValue('isAuthenticated', true);
                        GM_setValue('connectionTimestamp', connectionTimestamp.toString());
                        GM_setValue('subscriptionExpiry', subscriptionExpiry);
                        GM_setValue('winnaUsername', winnaUsername);
                        GM_setValue('winnaUserId', winnaUserId);
                        GM_setValue('telegramLinked', telegramLinked);
                        GM_setValue('telegramNotifyEnabled', telegramNotifyEnabled);
                        
                        const header = document.getElementById('winna-header');
                        if (header) header.remove();
                        const showBtn = document.getElementById('winna-show-btn');
                        if (showBtn) showBtn.remove();
                        const panel = document.getElementById('winna-panel');
                        if (panel) panel.remove();
                        const manualPanel = document.getElementById('winna-manual-panel');
                        if (manualPanel) manualPanel.remove();
                        
                        injectUI();
                        
                        let expiryDisplay = 'Lifetime';
                        if (subscriptionExpiry) {
                            const expiryDate = new Date(subscriptionExpiry);
                            const now = new Date();
                            const diffMs = expiryDate - now;
                            const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
                            
                            if (diffMs < 0) {
                                expiryDisplay = 'Expired';
                            } else if (diffMs < 60 * 60 * 1000) {
                                expiryDisplay = `${Math.ceil(diffMs / (1000 * 60))} min`;
                            } else if (diffMs < 24 * 60 * 60 * 1000) {
                                expiryDisplay = `${Math.ceil(diffMs / (1000 * 60 * 60))} hr`;
                            } else if (diffDays <= 7) {
                                expiryDisplay = `${diffDays}d`;
                            } else {
                                expiryDisplay = expiryDate.toISOString().split('T')[0];
                            }
                        }
                        
                        updateStatus(`✅ ${winnaUsername} - ${expiryDisplay}`);
                        console.log(`✅ Auto-connected! Username: ${winnaUsername}`);
                        
                        connectWebSocket();
                        
                    } else {
                        const errorMsg = data.error || 'No active subscription';
                        console.log(`❌ Not subscribed: ${errorMsg}`);
                        
                        isAuthenticated = false;
                        accessToken = null;
                        refreshToken = null;
                        subscriptionExpiry = null;
                        connectionTimestamp = null;
                        
                        GM_deleteValue('accessToken');
                        GM_deleteValue('refreshToken');
                        GM_deleteValue('isAuthenticated');
                        GM_deleteValue('subscriptionExpiry');
                        GM_deleteValue('connectionTimestamp');
                        
                        codes = [];
                        processedCodes = {};
                        claimOutcomes = {};
                        GM_setValue('localCodes', '[]');
                        GM_setValue('processedCodes', '{}');
                        
                        const header = document.getElementById('winna-header');
                        if (header) header.remove();
                        const showBtn = document.getElementById('winna-show-btn');
                        if (showBtn) showBtn.remove();
                        const panel = document.getElementById('winna-panel');
                        if (panel) panel.remove();
                        
                        injectUI();
                        
                        updateStatus(`🔒 ${winnaUsername} - ${errorMsg}`);
                    }
                } catch (e) {
                    updateStatus(`❌ Connection error`);
                    console.error('❌ Failed to parse response:', e);
                }
            },
            onerror: function(error) {
                isConnecting = false;
                updateStatus(`❌ Network error`);
                console.error('❌ Network error:', error);
            },
            ontimeout: function() {
                isConnecting = false;
                updateStatus(`❌ Timeout`);
                console.error('❌ Connection timeout');
            }
        });
    }
    
    let lastDetectedUsername = null;
    
    function startUsernameTracking() {
        console.log('👁️ Starting live user tracking for Winna...');
        
        const checkAndConnect = async () => {
            const username = getWinnaUsername();
            
            if (!username) {
                if (lastDetectedUsername) {
                    console.log('👋 User logged out - FULL RESET');
                    lastDetectedUsername = null;
                    resetAuthState();
                    updateStatus('🔍 Waiting for login...');
                }
                return;
            }
            
            if (username && username !== lastDetectedUsername) {
                console.log(`🔄 Username detected from localStorage: ${username}`);
                
                if (lastDetectedUsername) {
                    console.log('🔄 Account switch detected - resetting auth state');
                    resetAuthState({ newUsername: username });
                }
                
                lastDetectedUsername = username;
                
                const userId = getWinnaUserId();
                autoConnectWithUsername(username, userId);
            }
        };
        
        checkAndConnect();
        
        setInterval(checkAndConnect, TIMEOUTS.USERNAME_CHECK);
    }
    
    function togglePanel() {
        const panel = document.getElementById('winna-panel');
        if (panel) {
            panel.style.display = panel.style.display === 'none' ? 'flex' : 'none';
        }
    }
    
    function toggleHeader() {
        const header = document.getElementById('winna-header');
        const showBtn = document.getElementById('winna-show-btn');
        
        if (header && showBtn) {
            const visible = header.style.display !== 'none';
            header.style.display = visible ? 'none' : 'flex';
            showBtn.style.display = visible ? 'block' : 'none';
            GM_setValue('headerVisible', !visible);
        }
    }
    
    function updateStatus(status) {
        const el = document.getElementById('winna-status');
        if (el) {
            el.innerHTML = status;
        }
    }
    
    function updateUI() {
        const totalEl = document.getElementById('stat-total');
        const claimedEl = document.getElementById('stat-claimed');
        const rejectedEl = document.getElementById('stat-rejected');
        
        if (totalEl) totalEl.textContent = codes.length;
        if (claimedEl) claimedEl.textContent = codes.filter(c => c.claimed).length;
        if (rejectedEl) rejectedEl.textContent = codes.filter(c => c.rejectionReason).length;
    }
    
    function updateCodesList() {
        const container = document.getElementById('winna-codes-list');
        if (!container) return;
        
        if (codes.length === 0) {
            container.innerHTML = `
                <div style="text-align:center; padding:40px; color:#666;">
                    <div style="font-size:48px; margin-bottom:15px;">📭</div>
                    <div style="font-size:16px; font-weight:600;">No codes yet</div>
                    <div style="font-size:13px; opacity:0.7; margin-top:8px;">Waiting for new codes...</div>
                </div>`;
            return;
        }
        
        container.innerHTML = codes.map(code => {
            const statusClass = code.claimed ? 'claimed' : code.rejectionReason ? 'rejected' : '';
            const badge = code.claimed ? 
                '<span class="code-badge claimed">✅ CLAIMED</span>' : 
                code.rejectionReason ? 
                '<span class="code-badge rejected">❌ REJECTED</span>' : 
                '<span class="code-badge pending">⏳ PENDING</span>';
            
            const timeAgo = getTimeAgo(code.timestamp);
            
            return `
                <div class="code-item ${statusClass}">
                    <div class="code-header">
                        <span class="code-value">${code.code}</span>
                        ${badge}
                    </div>
                    <div class="code-info-grid">
                        <div>
                            <div class="code-info-label">Value</div>
                            <div class="code-info-value">${code.amount}</div>
                        </div>
                        <div>
                            <div class="code-info-label">Wager</div>
                            <div class="code-info-value">${code.wager}</div>
                        </div>
                        <div>
                            <div class="code-info-label">Deadline</div>
                            <div class="code-info-value">${code.deadline}</div>
                        </div>
                        <div>
                            <div class="code-info-label">Received</div>
                            <div class="code-info-value">${timeAgo}</div>
                        </div>
                    </div>
                    ${code.rejectionReason ? `<div class="code-rejection-reason">⚠️ ${code.rejectionReason}</div>` : ''}
                </div>`;
        }).join('');
    }
    
    function getTimeAgo(timestamp) {
        const seconds = Math.floor((Date.now() - timestamp) / 1000);
        if (seconds < 60) return 'Just now';
        if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
        if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
        return `${Math.floor(seconds / 86400)}d ago`;
    }
    
    function injectUI() {
        const totalCodes = codes.length;
        const claimedCodes = codes.filter(c => c.claimed).length;
        const rejectedCodes = codes.filter(c => c.rejectionReason).length;
        const headerVisible = GM_getValue('headerVisible', true);
        
        const statusIndicator = isAuthenticated ? 
            `<div id="winna-status" style="padding: 5px 12px; background: rgba(0,255,136,0.2);
                border: 1px solid #00ff88; border-radius: 5px; font-size: 12px; color: #00ff88;">
                ✅ Active
            </div>` :
            `<div id="winna-status" style="padding: 5px 12px; background: rgba(255,193,7,0.2);
                border: 1px solid #ffc107; border-radius: 5px; font-size: 12px; color: #ffc107;">
                🔍 Waiting for login...
            </div>`;
        
        const searchingIndicator = isAuthenticated ? 
            `<div id="winna-searching" style="padding: 5px 12px; background: rgba(0,255,136,0.1);
                border: 1px solid #00ff88; border-radius: 5px; font-size: 12px; color: #00ff88; display: flex; align-items: center; gap: 8px;">
                <span class="green-dot" style="width: 8px; height: 8px; background: #00ff88; border-radius: 50%; animation: pulse-dot 1.5s infinite;"></span>
                Searching for Codes...
            </div>` : '';
        
        document.body.insertAdjacentHTML('beforeend', `
        <div id="winna-header" style="position: fixed; top: 0; left: 0; right: 0; z-index: 999999; display: ${headerVisible ? 'flex' : 'none'};
            background: linear-gradient(135deg, #0a1628 0%, #1a2f4e 50%, #0f1f35 100%);
            backdrop-filter: blur(10px);
            box-shadow: 0 4px 20px rgba(0,0,0,0.5), 0 0 60px rgba(0,136,255,0.15);
            border-bottom: 2px solid rgba(0,136,255,0.3);
            padding: 12px 24px;
            align-items: center; justify-content: space-between; font-family: 'Inter', 'Segoe UI', sans-serif;
            color: #fff; font-size: 14px;">
            
            <div style="display:flex; align-items:center; gap:20px;">
                <div style="display:flex; align-items:center; gap:12px;">
                    <div style="width: 45px; height: 45px; background: linear-gradient(135deg, #0088ff, #00aaff); 
                        border-radius: 8px; display: flex; align-items: center; justify-content: center; 
                        font-size: 24px; box-shadow: 0 0 20px rgba(0,136,255,0.4);">W</div>
                    <div>
                        <div style="font-weight:700; font-size:18px; background: linear-gradient(135deg, #00aaff, #0088ff, #00ff88);
                            -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text;">
                            WINNA CODE CLAIMER
                        </div>
                        <div style="font-size:10px; opacity:0.7; margin-top:2px;">v2.0.0 - VIP Auto-Claim</div>
                    </div>
                </div>
                <a href="https://t.me/WinnaSubscriptionBot" target="_blank" 
                    style="padding: 8px 16px; background: linear-gradient(135deg, #0088ff, #00aaff);
                    border-radius: 8px; text-decoration: none; color: #fff; font-size: 13px; font-weight: 600;
                    box-shadow: 0 4px 15px rgba(0,136,255,0.4); transition: all 0.3s; border: 1px solid rgba(255,255,255,0.2);
                    display: flex; align-items: center; gap: 8px;" 
                    onmouseover="this.style.transform='translateY(-2px)'; this.style.boxShadow='0 6px 25px rgba(0,136,255,0.6)';"
                    onmouseout="this.style.transform='translateY(0)'; this.style.boxShadow='0 4px 15px rgba(0,136,255,0.4)';">
                    <svg style="width: 18px; height: 18px;" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.562 8.161c-.18 1.897-.962 6.502-1.359 8.627-.168.9-.5 1.201-.82 1.23-.697.064-1.226-.461-1.901-.903-1.056-.693-1.653-1.124-2.678-1.8-1.185-.781-.417-1.21.258-1.911.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.139-5.062 3.345-.479.329-.913.489-1.302.481-.428-.009-1.252-.242-1.865-.442-.752-.244-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.831-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635.099-.002.321.023.465.14.121.099.154.232.17.326.016.094.036.308.02.475z"/>
                    </svg>
                    💎 Buy Subscription
                </a>
                <span id="winna-username" style="font-size:13px; padding:6px 14px; background:rgba(255,255,255,0.1); 
                    backdrop-filter: blur(5px); border-radius:8px; border: 1px solid rgba(255,255,255,0.2);">
                    👤 ${winnaUsername || 'Not connected'}
                </span>
            </div>
            
            <div style="display:flex; align-items:center; gap:20px;">
                ${searchingIndicator}
                ${statusIndicator}
                <button id="winna-reset-btn" style="background: linear-gradient(135deg, rgba(255,68,68,0.2), rgba(255,68,68,0.3));
                    border: 1px solid rgba(255,68,68,0.5); color: #ff4444; padding: 8px 16px;
                    border-radius: 8px; cursor: pointer; font-size: 13px; font-weight: 600; transition: all 0.3s;">
                    🗑️ Reset
                </button>
                ${isAuthenticated ? `<button id="winna-manual-open-btn" style="background: linear-gradient(135deg, #00ff88, #00cc6e);
                    border: 1px solid rgba(0,255,136,0.5); color: #000; padding: 8px 16px;
                    border-radius: 8px; cursor: pointer; font-size: 13px; font-weight: 700; transition: all 0.3s;
                    box-shadow: 0 2px 10px rgba(0,255,136,0.3);">
                    ⚡ Manual Code
                </button>` : ''}
                <button id="winna-panel-btn" style="background: linear-gradient(135deg, rgba(0,136,255,0.3), rgba(0,170,255,0.3));
                    border: 1px solid rgba(255,255,255,0.3); color: #fff; padding: 8px 16px;
                    border-radius: 8px; cursor: pointer; font-size: 13px; font-weight: 600; transition: all 0.3s;">
                    📊 Dashboard
                </button>
                <button id="winna-minimize-btn" style="background: rgba(255,255,255,0.1);
                    border: 1px solid rgba(255,255,255,0.2); color: #fff; padding: 8px 14px;
                    border-radius: 8px; cursor: pointer; font-size: 13px; font-weight: 600; transition: all 0.3s;">
                    ▼ Hide
                </button>
            </div>
        </div>
        
        <button id="winna-show-btn" style="position: fixed; top: 10px; right: 10px; z-index: 999999;
            background: linear-gradient(135deg, #0088ff 0%, #00aaff 100%);
            border: 1px solid rgba(255,255,255,0.3); color: #fff; padding: 8px 16px;
            border-radius: 6px; cursor: pointer; font-size: 13px; font-weight: 600; display: ${headerVisible ? 'none' : 'block'};
            box-shadow: 0 2px 10px rgba(0,0,0,0.3);">
            ▲ Show Code Claimer
        </button>
        
        <div id="winna-manual-panel" style="position: fixed; top: 70px; right: 370px; z-index: 1000000;
            background: #0a1628; border: 2px solid #00ff88; border-radius: 12px; padding: 20px;
            box-shadow: 0 8px 32px rgba(0,255,136,0.4), 0 0 60px rgba(0,255,136,0.2); width: 350px; display: none;
            font-family: 'Inter', 'Segoe UI', sans-serif; color: #e0e6ed;">
            
            <div style="margin-bottom: 15px;">
                <label style="display:block; margin-bottom:8px; font-size:13px; opacity:0.8; font-weight:600;">Enter Promo Code:</label>
                <input id="manual-code-input" type="text" placeholder="type code here..." 
                    style="width: 100%; padding: 10px 14px; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.3);
                    border-radius: 6px; color: #fff; font-size: 14px; outline: none; box-sizing: border-box;"
                    autocomplete="off" spellcheck="false" maxlength="20">
            </div>
            
            <button id="manual-claim-btn" style="width: 100%; background: linear-gradient(135deg, #00ff88, #00cc6e);
                border: none; color: #000; padding: 12px 20px;
                border-radius: 6px; cursor: pointer; font-size: 14px; font-weight: 700; transition: all 0.3s;
                box-shadow: 0 4px 15px rgba(0,255,136,0.4);">
                ⚡ GO
            </button>
        </div>

        <div id="winna-panel" style="position: fixed; top: 60px; right: 20px; bottom: 20px; z-index: 999998;
            background: #0a1628; border: 1px solid #1a3f6f; border-radius: 12px; padding: 0;
            box-shadow: 0 8px 32px rgba(0,0,0,0.5); width: 450px; display: none;
            font-family: 'Inter', 'Segoe UI', sans-serif; color: #e0e6ed; overflow: hidden;
            flex-direction: column;">
            
            <div style="display:flex; justify-content:space-between; align-items:center; padding:20px; border-bottom: 1px solid #1a3f6f;">
                <h3 style="margin:0; color:#fff; font-size:20px;">📊 Code Dashboard</h3>
                <button id="winna-panel-close" style="background:none; border:none; color:#fff; 
                    font-size:22px; cursor:pointer; padding:0; width:30px; height:30px;">✕</button>
            </div>
            
            <div style="display:flex; gap:12px; padding:15px 20px; border-bottom: 1px solid #1a3f6f; background: rgba(255,255,255,0.02);">
                <div style="flex:1; padding: 12px; background: rgba(255,255,255,0.05); border-radius: 8px; border: 1px solid rgba(255,255,255,0.1); text-align:center;">
                    <div style="opacity:0.6; font-size:11px; text-transform:uppercase; margin-bottom:4px;">Total</div>
                    <div id="stat-total" style="font-size:24px; font-weight:700;">${totalCodes}</div>
                </div>
                <div style="flex:1; padding: 12px; background: rgba(0,255,136,0.1); border-radius: 8px; border: 1px solid rgba(0,255,136,0.3); text-align:center;">
                    <div style="opacity:0.7; font-size:11px; text-transform:uppercase; margin-bottom:4px;">Claimed</div>
                    <div id="stat-claimed" style="font-size:24px; font-weight:700; color:#00ff88;">${claimedCodes}</div>
                </div>
                <div style="flex:1; padding: 12px; background: rgba(255,68,68,0.1); border-radius: 8px; border: 1px solid rgba(255,68,68,0.3); text-align:center;">
                    <div style="opacity:0.7; font-size:11px; text-transform:uppercase; margin-bottom:4px;">Rejected</div>
                    <div id="stat-rejected" style="font-size:24px; font-weight:700; color:#ff4444;">${rejectedCodes}</div>
                </div>
            </div>

            <div id="winna-codes-list" style="flex: 1; overflow-y: auto; padding: 15px;">
            </div>
            
            <div id="winna-scroll-controls" style="position: absolute; bottom: 20px; right: 20px; display: flex; flex-direction: column; gap: 8px; z-index: 10;">
                <button id="scroll-up-btn" style="background: rgba(255,255,255,0.15); border: 1px solid rgba(255,255,255,0.3); 
                    color: #fff; width: 40px; height: 40px; border-radius: 50%; cursor: pointer; font-size: 18px; 
                    display: flex; align-items: center; justify-content: center; transition: all 0.2s;">
                    ⬆️
                </button>
                <button id="scroll-down-btn" style="background: rgba(255,255,255,0.15); border: 1px solid rgba(255,255,255,0.3); 
                    color: #fff; width: 40px; height: 40px; border-radius: 50%; cursor: pointer; font-size: 18px; 
                    display: flex; align-items: center; justify-content: center; transition: all 0.2s;">
                    ⬇️
                </button>
            </div>
        </div>

        <style>
            @keyframes pulse-dot {
                0%, 100% { opacity: 1; transform: scale(1); }
                50% { opacity: 0.5; transform: scale(1.2); }
            }
            
            #winna-codes-list::-webkit-scrollbar { width: 8px; }
            #winna-codes-list::-webkit-scrollbar-track { background: #0a1628; }
            #winna-codes-list::-webkit-scrollbar-thumb { background: #1a5f9f; border-radius: 4px; }
            
            #scroll-up-btn:hover, #scroll-down-btn:hover {
                background: rgba(255,255,255,0.3);
                transform: scale(1.1);
            }
            
            .code-item {
                background: rgba(255,255,255,0.05);
                border: 1px solid #1a3f6f;
                border-radius: 8px;
                padding: 15px;
                margin-bottom: 12px;
                transition: all 0.3s ease;
            }
            .code-item:hover {
                background: rgba(255,255,255,0.08);
                transform: translateY(-2px);
            }
            .code-item.claimed {
                background: rgba(0,255,136,0.1);
                border-color: #00ff88;
            }
            .code-item.rejected {
                background: rgba(255,68,68,0.1);
                border-color: #ff4444;
            }
            .code-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                margin-bottom: 10px;
            }
            .code-value {
                font-size: 20px;
                font-weight: 700;
                color: #0088ff;
                font-family: 'Courier New', monospace;
            }
            .code-badge {
                padding: 4px 10px;
                border-radius: 12px;
                font-size: 11px;
                font-weight: 600;
            }
            .code-badge.claimed { background: #00ff88; color: #000; }
            .code-badge.rejected { background: #ff4444; color: #fff; }
            .code-badge.pending { background: #ffa500; color: #000; }
            .code-info-grid {
                display: grid;
                grid-template-columns: 1fr 1fr;
                gap: 8px;
                margin: 10px 0;
                padding: 10px;
                background: rgba(0,0,0,0.2);
                border-radius: 6px;
                font-size: 12px;
            }
            .code-info-label {
                opacity: 0.6;
                font-size: 10px;
                text-transform: uppercase;
            }
            .code-info-value {
                font-weight: 600;
                margin-top: 2px;
            }
            .code-rejection-reason {
                background: rgba(255,68,68,0.2);
                border-left: 3px solid #ff4444;
                padding: 10px;
                margin: 10px 0;
                border-radius: 4px;
                font-size: 12px;
                color: #ffaaaa;
            }
        </style>
        `);

        document.getElementById('winna-panel-btn').onclick = togglePanel;
        document.getElementById('winna-panel-close').onclick = togglePanel;
        document.getElementById('winna-reset-btn').onclick = clearAllCodes;
        document.getElementById('winna-minimize-btn').onclick = toggleHeader;
        document.getElementById('winna-show-btn').onclick = toggleHeader;
        
        const manualOpenBtn = document.getElementById('winna-manual-open-btn');
        const manualClaimBtn = document.getElementById('manual-claim-btn');
        const manualCodeInput = document.getElementById('manual-code-input');
        
        if (manualOpenBtn) {
            manualOpenBtn.onclick = toggleManualPanel;
        }
        
        if (manualClaimBtn) {
            manualClaimBtn.onclick = handleManualClaim;
        }
        
        if (manualCodeInput) {
            manualCodeInput.addEventListener('keypress', function(e) {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    handleManualClaim();
                }
            });
        }
        
        document.addEventListener('click', function(e) {
            const panel = document.getElementById('winna-manual-panel');
            const btn = document.getElementById('winna-manual-open-btn');
            if (panel && btn && panel.style.display === 'block') {
                if (!panel.contains(e.target) && e.target !== btn) {
                    closeManualPanel();
                }
            }
        });
        
        document.getElementById('scroll-up-btn').onclick = () => {
            const codesList = document.getElementById('winna-codes-list');
            codesList.scrollBy({ top: -300, behavior: 'smooth' });
        };
        
        document.getElementById('scroll-down-btn').onclick = () => {
            const codesList = document.getElementById('winna-codes-list');
            codesList.scrollBy({ top: 300, behavior: 'smooth' });
        };
        
        updateCodesList();
    }
    
    function init() {
        console.log('🚀 Winna Code Claimer initializing...');
        
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => {
                setTimeout(() => {
                    injectUI();
                    startUsernameTracking();
                }, 1000);
            });
        } else {
            setTimeout(() => {
                injectUI();
                startUsernameTracking();
            }, 1000);
        }
    }
    
    init();
})();
