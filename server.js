const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const crypto = require("crypto");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use(express.static("public"));

const groups = new Map();

function generateCode() {
    return crypto.randomBytes(4).toString("hex").toUpperCase();
}

// CREATE GROUP
app.post("/api/create-group", (req, res) => {
    const { groupName, adminName } = req.body;

    if (!groupName || !adminName) {
        return res.status(400).json({
            success: false,
            message: "Group name and your name are required."
        });
    }

    let code;

    do {
        code = generateCode();
    } while (groups.has(code));

    const group = {
        name: groupName.trim(),
        code,
        admin: adminName.trim(),
        members: [],
        messages: []
    };

    groups.set(code, group);

    res.json({
        success: true,
        group
    });
});

// JOIN GROUP
app.post("/api/join-group", (req, res) => {
    const { code, memberName } = req.body;

    if (!code || !memberName) {
        return res.status(400).json({
            success: false,
            message: "Group code and your name are required."
        });
    }

    const groupCode = code.trim().toUpperCase();
    const group = groups.get(groupCode);

    if (!group) {
        return res.status(404).json({
            success: false,
            message: "Invalid group code."
        });
    }

    if (group.members.length >= 5) {
        return res.status(400).json({
            success: false,
            message: "Group is full. Maximum 5 members allowed."
        });
    }

    res.json({
        success: true,
        group
    });
});

// SOCKET CONNECTION
io.on("connection", (socket) => {

    console.log("User connected:", socket.id);

    // JOIN ROOM
    socket.on("joinRoom", ({ code, name }) => {

        const group = groups.get(code);

        if (!group) {
            socket.emit("errorMessage", "Invalid group code.");
            return;
        }

        // Check if this socket is already in group
        const existingMember = group.members.find(
            member => member.socketId === socket.id
        );

        if (!existingMember) {

            if (group.members.length >= 5) {
                socket.emit("errorMessage", "Group is full.");
                return;
            }

            group.members.push({
                name: name,
                socketId: socket.id,
                online: true
            });
        }

        socket.join(code);

        socket.groupCode = code;
        socket.userName = name;

        socket.emit("groupData", {
            name: group.name,
            code: group.code,
            admin: group.admin,
            members: group.members.map(member => ({
                name: member.name,
                online: member.online
            })),
            messages: group.messages
        });

        socket.to(code).emit("systemMessage", {
            text: `${name} joined the group`,
            time: new Date().toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit"
            })
        });

        io.to(code).emit(
            "membersUpdate",
            group.members.map(member => ({
                name: member.name,
                online: member.online
            }))
        );

        console.log(`${name} joined room ${code}`);
    });

    // SEND MESSAGE
    socket.on("sendMessage", ({ code, message }) => {

        const group = groups.get(code);

        if (!group || !message.trim()) {
            return;
        }

        const newMessage = {
            id: crypto.randomUUID(),
            sender: socket.userName,
            message: message.trim(),
            time: new Date().toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit"
            })
        };

        group.messages.push(newMessage);

        // Keep only latest 200 messages
        if (group.messages.length > 200) {
            group.messages.shift();
        }

        io.to(code).emit("newMessage", newMessage);
    });

    // DELETE MESSAGE
    socket.on("deleteMessage", ({ code, messageId }) => {

        const group = groups.get(code);

        if (!group) {
            return;
        }

        const message = group.messages.find(
            msg => msg.id === messageId
        );

        if (!message) {
            return;
        }

        // Only message owner can delete
        if (message.sender !== socket.userName) {
            return;
        }

        group.messages = group.messages.filter(
            msg => msg.id !== messageId
        );

        io.to(code).emit("messageDeleted", messageId);
    });

    // TYPING
    socket.on("typing", ({ code }) => {
        socket.to(code).emit("userTyping", socket.userName);
    });

    socket.on("stopTyping", ({ code }) => {
        socket.to(code).emit("userStopTyping");
    });

    // DISCONNECT
    socket.on("disconnect", () => {

        const code = socket.groupCode;

        if (!code) {
            return;
        }

        const group = groups.get(code);

        if (!group) {
            return;
        }

        group.members = group.members.filter(
            member => member.socketId !== socket.id
        );

        socket.to(code).emit("systemMessage", {
            text: `${socket.userName} left the group`,
            time: new Date().toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit"
            })
        });

        io.to(code).emit(
            "membersUpdate",
            group.members.map(member => ({
                name: member.name,
                online: member.online
            }))
        );

        console.log("User disconnected:", socket.id);
    });
});

// SERVER
const PORT = 3000;

server.listen(PORT, () => {
    console.log(`Chat server running at http://localhost:${PORT}`);
});