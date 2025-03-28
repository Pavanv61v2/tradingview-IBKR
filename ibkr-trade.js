const axios = require('axios');
const fs = require('fs');

// Trade log file
const TRADE_LOG_FILE = 'trade_history.json';

// IBKR API settings
const IBKR_API = {
  baseUrl: 'https://localhost:5000/v1/portal', // Default Client Portal API address
  sslVerify: false, // Disable SSL verification for local connections
  timeout: 30000 // 30 seconds timeout
};

// Main function to place an order with IBKR
async function placeOrder() {
  try {
    // Get credentials from environment variables
    const username = process.env.IBKR_USERNAME;
    const password = process.env.IBKR_PASSWORD;
    const accountId = process.env.IBKR_ACCOUNT_ID;
    
    if (!username || !password) {
      throw new Error("IBKR credentials not provided");
    }
    
    // Parse signal data from TradingView webhook
    let signal;
    try {
      signal = process.env.SIGNAL_DATA ? JSON.parse(process.env.SIGNAL_DATA) : null;
      if (!signal) {
        throw new Error("No signal data provided");
      }
    } catch(e) {
      console.error("Error parsing signal data:", e.message);
      throw e;
    }
    
    console.log("Processing signal:", JSON.stringify(signal, null, 2));
    
    // Extract trading information
    const ticker = signal.symbol || signal.ticker;
    if (!ticker) {
      throw new Error("No symbol provided in signal");
    }
    
    const action = signal.action;
    if (!action) {
      throw new Error("No action (buy/sell) provided in signal");
    }
    
    // Determine order direction
    const isBuy = action.toLowerCase() === 'buy';
    const orderSide = isBuy ? 'BUY' : 'SELL';
    
    // Parse order size
    let orderQuantity;
    if (signal.order_size && !isNaN(parseFloat(signal.order_size))) {
      orderQuantity = parseFloat(signal.order_size);
    } else {
      // Default order size
      orderQuantity = 1; // Default to 1 share/contract - adjust as needed
    }
    
    // Format the symbol for IBKR (this needs customization for your assets)
    const formattedSymbol = formatSymbolForIBKR(ticker);
    
    // IBKR Authentication and Order Process
    // Note: In a real implementation, you'll need to:
    // 1. Authenticate with IBKR
    // 2. Check if session is active
    // 3. Select account
    // 4. Place the order
    console.log(`Preparing to place ${orderSide} order for ${orderQuantity} of ${formattedSymbol}`);
    
    try {
      // STEP 1: Authentication with IBKR (Client Portal API)
      console.log("Authenticating with IBKR...");
      const instance = axios.create({
        baseURL: IBKR_API.baseUrl,
        timeout: IBKR_API.timeout,
        httpsAgent: new (require('https').Agent)({
          rejectUnauthorized: IBKR_API.sslVerify
        })
      });
      
      // Authenticate
      // Note: In practice, you'd need to authenticate with IBKR's Client Portal API
      // This is a simplified example and would need to be adjusted
      const authResponse = await instance.post('/oauth/token', {
        username: username,
        password: password
      });
      
      if (!authResponse.data || authResponse.data.error) {
        throw new Error(`Authentication failed: ${authResponse.data?.error || 'Unknown error'}`);
      }
      
      console.log("Authentication successful");
      
      // STEP 2: Check if session is active
      const tickleResponse = await instance.post('/tickle');
      console.log("Session status:", tickleResponse.data);
      
      // STEP 3: Select account
      await instance.post('/account', {
        acctId: accountId
      });
      console.log(`Selected account: ${accountId}`);
      
      // STEP 4: Place the order
      // Define the order
      const order = {
        acctId: accountId,
        conid: getConidForSymbol(formattedSymbol), // You'll need a mapping of symbols to contract IDs
        secType: 'STK', // Stock (adjust as needed)
        orderType: 'MKT', // Market order
        side: orderSide,
        quantity: orderQuantity,
        tif: 'DAY' // Time in force
      };
      
      console.log("Placing order:", order);
      
      // Place the order
      const orderResponse = await instance.post('/order', order);
      
      console.log("Order response:", orderResponse.data);
      
      // STEP 5: Log the trade
      const tradeInfo = {
        timestamp: new Date().toISOString(),
        symbol: formattedSymbol,
        action: isBuy ? 'buy' : 'sell',
        orderSize: orderQuantity,
        orderId: orderResponse.data?.id || 'unknown',
        status: 'success'
      };
      
      await logTrade(tradeInfo);
      
      return {
        success: true,
        order: orderResponse.data
      };
      
    } catch (apiError) {
      console.error("IBKR API Error:", apiError.message);
      if (apiError.response) {
        console.error("API Response:", apiError.response.data);
      }
      
      // Log the failed trade
      const tradeInfo = {
        timestamp: new Date().toISOString(),
        symbol: formattedSymbol,
        action: isBuy ? 'buy' : 'sell',
        orderSize: orderQuantity,
        status: 'failed',
        error: apiError.message
      };
      
      await logTrade(tradeInfo);
      
      throw apiError;
    }
    
  } catch (error) {
    console.error("Error in order process:", error.message);
    
    // Log error to trade history
    try {
      const tradeInfo = {
        timestamp: new Date().toISOString(),
        symbol: signal?.symbol || 'UNKNOWN',
        action: signal?.action || 'UNKNOWN',
        status: 'failed',
        error: error.message
      };
      
      await logTrade(tradeInfo);
    } catch (logError) {
      console.error("Error logging trade:", logError.message);
    }
    
    return {
      success: false,
      error: error.message
    };
  }
}

// Helper function to format symbol for IBKR
function formatSymbolForIBKR(symbol) {
  // This is a placeholder - you'll need to customize this for your needs
  // IBKR symbols can have specific formats depending on asset class and exchange
  // E.g., for US stocks, you might just need the ticker symbol
  
  // Remove any / or spaces and make uppercase
  symbol = symbol.replace(/[\/\s]/g, '').toUpperCase();
  
  // Handle crypto pairs
  if (symbol.endsWith('USD') || symbol.endsWith('USDT')) {
    // Handle differently for crypto
    return symbol;
  }
  
  // For stocks, simply return the symbol
  return symbol;
}

// Helper function to get contract ID for a symbol
// In a real implementation, you'd need a more sophisticated approach
function getConidForSymbol(symbol) {
  // This is a placeholder. In practice, you'd need to:
  // 1. Either maintain a mapping of symbols to conids
  // 2. Or query IBKR's API to get the conid for a symbol
  
  // For demonstration, return a dummy conid
  return 123456; // Replace with actual logic
}

// Helper function to log trades
async function logTrade(tradeInfo) {
  try {
    // Check if the log file exists
    let trades = [];
    if (fs.existsSync(TRADE_LOG_FILE)) {
      // Read existing logs
      const data = fs.readFileSync(TRADE_LOG_FILE, 'utf8');
      try {
        trades = JSON.parse(data);
      } catch (e) {
        console.error("Error parsing trade history JSON:", e.message);
        trades = [];
      }
    }
    
    // Add the new trade
    trades.push(tradeInfo);
    
    // Write back to file
    fs.writeFileSync(TRADE_LOG_FILE, JSON.stringify(trades, null, 2));
    console.log("Trade logged successfully!");
  } catch (error) {
    console.error("Error logging trade:", error.message);
  }
}

// Execute the function
placeOrder().then((result) => {
  console.log("Order process completed:", result);
}).catch(err => {
  console.error("Unhandled error:", err);
});
