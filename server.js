const express=require("express");
const http=require("http");
const {Server}=require("socket.io");
const crypto=require("crypto");
const path=require("path");

const app=express();
const server=http.createServer(app);
const io=new Server(server);

app.use(express.json());
app.use(express.static(path.join(__dirname,"public")));

app.get("/",(req,res)=>{
    res.sendFile(path.join(__dirname,"public","index.html"));
});

const groups=new Map();
const FIXED_GROUP_CODE="NE2026ET2025";

function getTime(){
    return new Date().toLocaleTimeString("en-IN",{
        timeZone:"Asia/Kolkata",
        hour:"2-digit",
        minute:"2-digit",
        hour12:true
    });
}

// CREATE GROUP
app.post("/api/create-group",(req,res)=>{
    const {groupName,adminName}=req.body;

    if(!groupName||!adminName){
        return res.status(400).json({
            success:false,
            message:"Group name and admin name are required."
        });
    }

    let group=groups.get(FIXED_GROUP_CODE);

    if(!group){
        group={
            name:groupName.trim(),
            code:FIXED_GROUP_CODE,
            admin:adminName.trim(),
            members:[],
            messages:[]
        };

        groups.set(FIXED_GROUP_CODE,group);
    }

    res.json({
        success:true,
        group
    });
});

// JOIN GROUP
app.post("/api/join-group",(req,res)=>{
    const {code,memberName}=req.body;

    if(!code||!memberName){
        return res.status(400).json({
            success:false,
            message:"Group code and your name are required."
        });
    }

    const groupCode=code.trim().toUpperCase();

    if(groupCode!==FIXED_GROUP_CODE){
        return res.status(404).json({
            success:false,
            message:"Invalid group code."
        });
    }

    const group=groups.get(groupCode);

    if(!group){
        return res.status(404).json({
            success:false,
            message:"Group does not exist. Admin must create the group first."
        });
    }

    if(group.members.length>=5){
        return res.status(400).json({
            success:false,
            message:"Group is full. Maximum 5 members allowed."
        });
    }

    res.json({
        success:true,
        group
    });
});

// SOCKET CONNECTION
io.on("connection",(socket)=>{

    console.log("User connected:",socket.id);

    // JOIN ROOM
    socket.on("joinRoom",({code,name})=>{

        const groupCode=code.trim().toUpperCase();

        if(groupCode!==FIXED_GROUP_CODE){
            socket.emit("errorMessage","Invalid group code.");
            return;
        }

        const group=groups.get(groupCode);

        if(!group){
            socket.emit("errorMessage","Group does not exist.");
            return;
        }

        const existingMember=group.members.find(
            member=>member.socketId===socket.id
        );

        if(!existingMember){

            if(group.members.length>=5){
                socket.emit(
                    "errorMessage",
                    "Group is full. Maximum 5 members allowed."
                );
                return;
            }

            group.members.push({
                name:name.trim(),
                socketId:socket.id,
                online:true
            });
        }

        socket.join(groupCode);
        socket.groupCode=groupCode;
        socket.userName=name.trim();

        socket.emit("groupData",{
            name:group.name,
            code:group.code,
            admin:group.admin,
            members:group.members.map(member=>({
                name:member.name,
                online:member.online
            })),
            messages:group.messages
        });

        socket.to(groupCode).emit("systemMessage",{
            text:`${name} joined the group`,
            time:getTime()
        });

        io.to(groupCode).emit(
            "membersUpdate",
            group.members.map(member=>({
                name:member.name,
                online:member.online
            }))
        );

        console.log(`${name} joined room ${groupCode}`);
    });

    // SEND MESSAGE
    socket.on("sendMessage",({code,message})=>{

        const groupCode=code.trim().toUpperCase();
        const group=groups.get(groupCode);

        if(!group||!message||!message.trim()){
            return;
        }

        const newMessage={
            id:crypto.randomUUID(),
            sender:socket.userName,
            message:message.trim(),
            time:getTime()
        };

        group.messages.push(newMessage);

        if(group.messages.length>200){
            group.messages.shift();
        }

        io.to(groupCode).emit("newMessage",newMessage);
    });

    // DELETE MESSAGE
    socket.on("deleteMessage",({code,messageId})=>{

        const group=groups.get(code.trim().toUpperCase());

        if(!group){
            return;
        }

        const message=group.messages.find(
            msg=>msg.id===messageId
        );

        if(!message){
            return;
        }

        if(message.sender!==socket.userName){
            return;
        }

        group.messages=group.messages.filter(
            msg=>msg.id!==messageId
        );

        io.to(code).emit("messageDeleted",messageId);
    });

    // TYPING
    socket.on("typing",({code})=>{
        socket.to(code).emit(
            "userTyping",
            socket.userName
        );
    });

    socket.on("stopTyping",({code})=>{
        socket.to(code).emit("userStopTyping");
    });

    // DISCONNECT
    socket.on("disconnect",()=>{

        const code=socket.groupCode;

        if(!code){
            return;
        }

        const group=groups.get(code);

        if(!group){
            return;
        }

        group.members=group.members.filter(
            member=>member.socketId!==socket.id
        );

        socket.to(code).emit("systemMessage",{
            text:`${socket.userName} left the group`,
            time:getTime()
        });

        // LAST MEMBER LEFT = DELETE ALL CHAT
        if(group.members.length===0){
            group.messages=[];
        }

        io.to(code).emit(
            "membersUpdate",
            group.members.map(member=>({
                name:member.name,
                online:member.online
            }))
        );

        console.log("User disconnected:",socket.id);
    });
});

// SERVER
const PORT=process.env.PORT||3000;

server.listen(PORT,"0.0.0.0",()=>{
    console.log(`Chat server running on port ${PORT}`);
});