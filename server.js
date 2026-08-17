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
const MAIN_GROUP_CODE="NE2026ET2025";

function getTime(){
    return new Date().toLocaleTimeString("en-IN",{
        timeZone:"Asia/Kolkata",
        hour:"2-digit",
        minute:"2-digit",
        hour12:true
    });
}

function generateGroupCode(){
    let code;

    do{
        code=crypto.randomBytes(4).toString("hex").toUpperCase();
    }while(groups.has(code));

    return code;
}

function createGroup(name,admin,code){
    const group={
        name:name.trim(),
        code:code,
        admin:admin.trim(),
        members:[],
        messages:[]
    };

    groups.set(code,group);

    return group;
}

// CREATE GROUP
app.post("/api/create-group",(req,res)=>{
    const {groupName,adminName,groupType,customCode}=req.body;

    if(!groupName||!adminName){
        return res.status(400).json({
            success:false,
            message:"Group name and admin name are required."
        });
    }

    let code;

    if(groupType==="main"){
        code=MAIN_GROUP_CODE;
    }else{
        if(customCode&&customCode.trim()){
            code=customCode.trim().toUpperCase();

            if(code===MAIN_GROUP_CODE){
                return res.status(400).json({
                    success:false,
                    message:"This code is reserved for the main group."
                });
            }

            if(groups.has(code)){
                return res.status(400).json({
                    success:false,
                    message:"This group code is already in use."
                });
            }
        }else{
            code=generateGroupCode();
        }
    }

    if(groups.has(code)){
        return res.status(400).json({
            success:false,
            message:"This group already exists."
        });
    }

    const group=createGroup(
        groupName,
        adminName,
        code
    );

    res.json({
        success:true,
        group:{
            name:group.name,
            code:group.code,
            admin:group.admin
        }
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
    const group=groups.get(groupCode);

    if(!group){
        return res.status(404).json({
            success:false,
            message:"Invalid group code."
        });
    }

    const onlineMembers=group.members.filter(
        member=>member.online
    );

    if(onlineMembers.length>=5){
        return res.status(400).json({
            success:false,
            message:"Group is full. Maximum 5 members allowed."
        });
    }

    res.json({
        success:true,
        group:{
            name:group.name,
            code:group.code,
            admin:group.admin
        }
    });
});

// SOCKET CONNECTION
io.on("connection",(socket)=>{

    console.log("User connected:",socket.id);

    // JOIN ROOM
    socket.on("joinRoom",({code,name})=>{

        const groupCode=(code||"").trim().toUpperCase();
        const group=groups.get(groupCode);

        if(!group){
            socket.emit(
                "errorMessage",
                "Invalid group code."
            );
            return;
        }

        const onlineMembers=group.members.filter(
            member=>member.online
        );

        if(onlineMembers.length>=5){
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

        socket.join(groupCode);
        socket.groupCode=groupCode;
        socket.userName=name.trim();

        socket.emit("groupData",{
            name:group.name,
            code:group.code,
            admin:group.admin,
            members:group.members
                .filter(member=>member.online)
                .map(member=>({
                    name:member.name,
                    online:true
                })),
            messages:group.messages
        });

        socket.to(groupCode).emit(
            "systemMessage",
            {
                text:`${name} joined the group`,
                time:getTime()
            }
        );

        io.to(groupCode).emit(
            "membersUpdate",
            group.members
                .filter(member=>member.online)
                .map(member=>({
                    name:member.name,
                    online:true
                }))
        );
    });

    // SEND MESSAGE
    socket.on("sendMessage",({code,message})=>{

        const groupCode=(code||"").trim().toUpperCase();
        const group=groups.get(groupCode);

        if(!group||!message||!message.trim()){
            return;
        }

        const newMessage={
            id:crypto.randomUUID(),
            sender:socket.userName,
            message:message.trim(),
            time:getTime(),
            timestamp:Date.now()
        };

        group.messages.push(newMessage);

        if(group.messages.length>200){
            group.messages.shift();
        }

        io.to(groupCode).emit(
            "newMessage",
            newMessage
        );
    });

    // DELETE MESSAGE
    socket.on(
        "deleteMessage",
        ({code,messageId})=>{

            const groupCode=
                (code||"").trim().toUpperCase();

            const group=
                groups.get(groupCode);

            if(!group){
                return;
            }

            const message=
                group.messages.find(
                    msg=>msg.id===messageId
                );

            if(!message){
                return;
            }

            if(message.sender!==socket.userName){
                return;
            }

            group.messages=
                group.messages.filter(
                    msg=>msg.id!==messageId
                );

            io.to(groupCode).emit(
                "messageDeleted",
                messageId
            );
        }
    );

    // TYPING
    socket.on("typing",({code})=>{
        socket.to(code).emit(
            "userTyping",
            socket.userName
        );
    });

    socket.on("stopTyping",({code})=>{
        socket.to(code).emit(
            "userStopTyping"
        );
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

        group.members=
            group.members.filter(
                member=>member.socketId!==socket.id
            );

        socket.to(code).emit(
            "systemMessage",
            {
                text:`${socket.userName} left the group`,
                time:getTime()
            }
        );

        io.to(code).emit(
            "membersUpdate",
            group.members
                .filter(member=>member.online)
                .map(member=>({
                    name:member.name,
                    online:true
                }))
        );

        // Last member leaves:
        // clear this group's chat.
        if(group.members.length===0){
            group.messages=[];
        }

        console.log(
            `${socket.userName} disconnected from ${code}`
        );
    });
});

// SERVER
const PORT=process.env.PORT||3000;

server.listen(
    PORT,
    "0.0.0.0",
    ()=>{
        console.log(
            `Chat server running on port ${PORT}`
        );
    }
);