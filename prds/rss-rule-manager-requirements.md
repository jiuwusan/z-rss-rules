# RSS Rule Manager 需求文档

## 1. 项目名称

RSS Rule Manager

## 2. 项目背景

qBittorrent RSS 自动下载规则支持 mustContain、mustNotContain
和正则匹配。

当前存在多个压制组：

-   Pure@HDSWEB
-   HDSWEB
-   HHWEB
-   其他扩展压制组

业务需求：

1.  Pure@HDSWEB 默认全量下载。
2.  其他压制组默认不下载。
3.  指定剧集后，允许指定压制组下载。
4.  同一剧集只能属于一个压制组授权。
5.  自动生成互斥规则，不人工维护 mustNotContain。

## 3. 技术方案

### 前端

技术栈：

-   HTML
-   CSS
-   JavaScript

部署：

-   Nginx 静态文件托管

不使用：

-   后端服务
-   数据库

### 数据源

qBittorrent RSS Rules 作为唯一数据源。

接口：

-   GET /api/v2/rss/rules
-   POST /api/v2/rss/setRule

认证：

-   POST /api/v2/auth/login
-   浏览器自动保存 Cookie

## 4. 登录流程

打开页面：

1.  请求 RSS Rules。
2.  如果成功，进入管理页面。
3.  如果返回未认证，显示登录框。

登录成功后：

浏览器保存 SID Cookie。

后续 API 请求：

fetch(url, { credentials: "include" })

自动携带 Cookie。

## 5. 规则模型

### Pure@HDSWEB

特点：

-   默认全量下载。
-   不需要指定剧集。

示例：

mustContain:

H265-Pure.HDSWEB

### 特殊授权规则

其他压制组需要指定：

-   剧集名称
-   压制组
-   视频编码
-   分辨率

示例：

剧集：九门

压制组：HDSWEB

编码：H265

分辨率：1080p

生成规则：

H265 + 1080p + HDSWEB + 九门

## 6. 互斥规则

例如：

九门 -\> HDSWEB

生成：

HDSWEB：

允许下载九门。

Pure@HDSWEB：

自动排除九门。

HHWEB：

自动排除九门。

同一剧集只拥有一个压制组下载权限。

## 7. 页面功能

### 首页

显示：

-   登录状态
-   RSS Rule 数量
-   最后同步时间

### 特殊规则列表

字段：

  剧集   压制组   编码   分辨率
  ------ -------- ------ --------
  九门   HDSWEB   H265   1080p

支持：

-   新增
-   删除
-   修改

## 8. 规则生成流程

读取：

GET /api/v2/rss/rules

↓

解析现有规则

↓

生成业务模型

↓

用户修改

↓

生成新的 RSS Rules

↓

调用：

POST /api/v2/rss/setRule

## 9. 文件结构

rss-rule-manager/

-   index.html
-   css/style.css
-   js/app.js
-   js/api.js
-   js/rule-parser.js
-   js/rule-generator.js

## 10. MVP

第一版实现：

-   登录
-   获取 RSS Rules
-   展示规则
-   新增授权规则
-   删除授权规则
-   自动生成互斥规则
-   同步 qBittorrent
