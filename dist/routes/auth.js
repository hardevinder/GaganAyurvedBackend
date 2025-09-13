"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = authRoutes;
const authController_1 = require("../controllers/authController");
async function authRoutes(app) {
    app.post("/signup", authController_1.signup);
    app.post("/login", authController_1.login);
    app.post("/google-login", authController_1.googleLogin);
    app.post("/logout", authController_1.logout);
    app.get("/me", authController_1.me);
}
//# sourceMappingURL=auth.js.map